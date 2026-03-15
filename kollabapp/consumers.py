import json
import logging
import uuid
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Workspace, WorkspaceMembership, CustomUser
from .models import Message, DirectMessage

logger = logging.getLogger(__name__)

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.workspace_id = self.scope['url_route']['kwargs']['workspace_id']
        self.room_group_name = f"workspace_{self.workspace_id}"

        user = self.scope["user"]
        if not user.is_authenticated:
            await self.close()
            return

        # Join the workspace group by default so we always get channel-wide events
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        # keep track of what DM group we're currently in (server side doesn't need it, but makes debugging easier)
        self.current_dm_group = None

        # Log connection for debugging
        try:
            logger.info(f"WebSocket CONNECT user={user.username} workspace={self.workspace_id} channel={self.channel_name}")
        except Exception:
            # fallback to print if logging not configured
            print(f"WebSocket CONNECT user={getattr(user, 'username', 'anon')} workspace={self.workspace_id} channel={self.channel_name}")

    async def disconnect(self, close_code):
        # Leave group
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        try:
            logger.info(f"WebSocket DISCONNECT channel={self.channel_name} code={close_code}")
        except Exception:
            print(f"WebSocket DISCONNECT channel={self.channel_name} code={close_code}")

    # Receive message from WebSocket
    async def receive(self, text_data):
        data = json.loads(text_data)

        # join or leave special DM group
        if data.get("join_dm"):
            other = data.get("user_id")
            group = self.dm_group_name(self.scope["user"].id, other, self.workspace_id)
            await self.channel_layer.group_add(group, self.channel_name)
            self.current_dm_group = group
            return
        if data.get("leave_dm"):
            other = data.get("user_id")
            group = self.dm_group_name(self.scope["user"].id, other, self.workspace_id)
            await self.channel_layer.group_discard(group, self.channel_name)
            if self.current_dm_group == group:
                self.current_dm_group = None
            return

        # Handle typing notifications (for both group chat and DMs)
        if data.get("type") == "typing":
            username = self.scope["user"].username
            user_id = self.scope["user"].id
            receiver_id = data.get("receiver_id")
            
            if receiver_id:
                # Typing in DM
                group = self.dm_group_name(self.scope["user"].id, receiver_id, self.workspace_id)
                event = {
                    "type": "typing_indicator",
                    "username": username,
                    "sender_username": username,
                    "sender_id": user_id,
                }
                await self.channel_layer.group_send(group, event)
            else:
                # Typing in group chat
                event = {
                    "type": "typing_indicator",
                    "username": username,
                    "sender_username": username,
                    "sender_id": user_id,
                }
                await self.channel_layer.group_send(self.room_group_name, event)
            return

        # handle direct message payloads sent through the socket
        if data.get("dm") and data.get("receiver_id"):
            message = data.get("message")
            if not message or not message.strip():
                logger.warning(f"Empty DM message from {self.scope['user'].username}")
                return
            message_id = data.get('message_id') or str(uuid.uuid4())
            receiver_id = data.get("receiver_id")
            username = self.scope["user"].username
            user = await self.get_user_data()
            try:
                saved = await self.save_dm(message, receiver_id)
                group = self.dm_group_name(self.scope["user"].id, receiver_id, self.workspace_id)
                event = {
                    "type": "chat_message",
                    "dm": True,
                    "sender_id": self.scope["user"].id,
                    "receiver_id": receiver_id,
                    "message_id": message_id,
                    "message": message,
                    "username": username,
                    "sender_username": user.get('display_name', username),
                    "sender_avatar": user.get('avatar_url', '/static/Areeba.jpeg'),
                    "created_at": saved['created_at'],
                }
                await self.channel_layer.group_send(group, event)
            except Exception as exc:
                logger.exception(f"dm send failed: {exc}")
            return

        # ---------- fallback: normal workspace message ----------
        message = data.get('message')
        if not message or not message.strip():
            logger.warning(f"Empty workspace message from {self.scope['user'].username}")
            return
        message_id = data.get('message_id') or str(uuid.uuid4())
        username = self.scope["user"].username
        user = await self.get_user_data()
        try:
            saved = await self.save_message(message, message_id)
            event = {
                "type": "chat_message",
                "message_id": message_id,
                "message": message,
                "username": username,
                "sender_id": self.scope["user"].id,
                "sender_username": user.get('display_name', username),
                "sender_avatar": user.get('avatar_url', '/static/Areeba.jpeg'),
                "created_at": saved['created_at'],
                "db_id": saved['id'],
            }
            await self.channel_layer.group_send(self.room_group_name, event)
            logger.info(f"group_send: workspace={self.workspace_id} from={username} message={message}")
        except Exception as exc:
            # log failure
            logger.exception(f"group_send failed for workspace={self.workspace_id}: {exc}")
            print(f"group_send failed for workspace={self.workspace_id}: {exc}")

    # Receive message from group
    async def chat_message(self, event):
        # simply forward the entire event back to client; client will decide how to render
        try:
            logger.debug(f"chat_message sending to {self.channel_name}: {event}")
        except Exception:
            pass
        await self.send(text_data=json.dumps(event))
    
    # Receive typing indicator from group or DM group
    async def typing_indicator(self, event):
        # Broadcast typing notification to all connected clients in the group
        try:
            logger.debug(f"typing_indicator sending to {self.channel_name}: {event}")
        except Exception:
            pass
        await self.send(text_data=json.dumps(event))
    
    @database_sync_to_async
    def get_user_data(self):
        """Fetch user's display name and avatar"""
        user = self.scope["user"]
        avatar_url = "/static/Areeba.jpeg"
        if user.profile_picture:
            avatar_url = user.profile_picture.url
        return {
            'display_name': user.display_name,
            'avatar_url': avatar_url
        }

    @database_sync_to_async
    def save_dm(self, message_text, receiver_id):
        """Persist a direct message between two users."""
        try:
            ws = Workspace.objects.get(id=self.workspace_id)
        except Workspace.DoesNotExist:
            ws = None
        sender = self.scope['user'] if self.scope.get('user') and self.scope['user'].is_authenticated else None
        receiver = CustomUser.objects.get(id=receiver_id)
        dm = DirectMessage.objects.create(
            workspace=ws,
            sender=sender,
            receiver=receiver,
            message=message_text
        )
        return {'id': dm.id, 'created_at': dm.created_at.isoformat()}

    def dm_group_name(self, user1, user2, workspace_id):
        # deterministic group name for two users in a workspace
        u1, u2 = sorted([str(user1), str(user2)])
        return f"dm_{workspace_id}_{u1}_{u2}"

    @database_sync_to_async
    def save_message(self, message_text, message_uuid):
        """Save workspace chat message to DB and return a small dict for broadcasting."""
        try:
            ws = Workspace.objects.get(id=self.workspace_id)
        except Workspace.DoesNotExist:
            ws = None
        sender = self.scope['user'] if self.scope.get('user') and self.scope['user'].is_authenticated else None
        # ensure message_uuid valid
        parsed_uuid = None
        try:
            if message_uuid:
                import uuid as _uuid
                parsed_uuid = _uuid.UUID(str(message_uuid))
        except Exception:
            parsed_uuid = None
        if not parsed_uuid:
            import uuid as _uuid
            parsed_uuid = _uuid.uuid4()
        msg = Message.objects.create(workspace=ws, sender=sender, message=message_text, message_uuid=parsed_uuid)
        return {'id': msg.id, 'created_at': msg.created_at.isoformat()}

