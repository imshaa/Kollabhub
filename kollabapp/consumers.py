import json
import logging
import time
import uuid
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Workspace, WorkspaceMembership, CustomUser, Notification
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

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        self.current_dm_group = None

        logger.info(
            f"WebSocket CONNECT user={user.username} workspace={self.workspace_id} "
            f"channel={self.channel_name}"
        )

    def dm_group_name(self, user_a, user_b, workspace_id):
        try:
            a, b = int(user_a), int(user_b)
        except (TypeError, ValueError):
            raise ValueError("DM group name requires two valid user ids")
        if a == b:
            raise ValueError("DM group requires two different users")
        first, second = (a, b) if a < b else (b, a)
        return f"dm_{workspace_id}_{first}_{second}"

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        logger.info(f"WebSocket DISCONNECT channel={self.channel_name} code={close_code}")

    async def receive(self, text_data):
        data = json.loads(text_data)

        # ── Call signal relay ──────────────────────────────────────────
        if data.get("type") == "call_signal":
            event = {
                "type":         "call_signal",
                "signal":       data.get("signal"),
                "call_id":      data.get("call_id"),
                "call_type":    data.get("call_type"),
                "caller_id":    self.scope["user"].id,
                "caller_name":  self.scope["user"].username,
                "workspace_id": self.workspace_id,
            }
            await self.channel_layer.group_send(self.room_group_name, event)
            return

        # ── DM join / leave ────────────────────────────────────────────
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

        # ── Typing ────────────────────────────────────────────────────
        if data.get("type") == "typing":
            username    = self.scope["user"].username
            user_id     = self.scope["user"].id
            receiver_id = data.get("receiver_id")
            event = {
                "type":            "typing_indicator",
                "username":        username,
                "sender_username": username,
                "sender_id":       user_id,
            }
            if receiver_id:
                group = self.dm_group_name(self.scope["user"].id, receiver_id, self.workspace_id)
                await self.channel_layer.group_send(group, event)
            else:
                await self.channel_layer.group_send(self.room_group_name, event)
            return

        # ── Voice note ────────────────────────────────────────────────
        if data.get("type") == "voice_note":
            voice_url        = data.get("voice_url")
            duration         = data.get("duration")
            message_id       = data.get('message_id') or str(uuid.uuid4())
            sender_username  = data.get("sender_username") or self.scope["user"].username
            sender_avatar    = data.get("sender_avatar") or '/static/Areeba.jpeg'
            created_at       = data.get("created_at") or time.strftime('%Y-%m-%dT%H:%M:%S.%fZ', time.gmtime())
            if data.get("dm") and data.get("receiver_id"):
                receiver_id = data.get("receiver_id")
                group = self.dm_group_name(self.scope["user"].id, receiver_id, self.workspace_id)
                event = {
                    "type":            "voice_note",
                    "dm":              True,
                    "sender_id":       self.scope["user"].id,
                    "receiver_id":     receiver_id,
                    "message_id":      message_id,
                    "voice_url":       voice_url,
                    "duration":        duration,
                    "sender_username": sender_username,
                    "sender_avatar":   sender_avatar,
                    "created_at":      created_at,
                }
                await self.channel_layer.group_send(group, event)
                await self.channel_layer.group_send(self.room_group_name, {
                    "type":                    "notification_event",
                    "notification":            True,
                    "notification_section":    "dm",
                    "notification_type":       "dm_message",
                    "notification_message":    f"New DM from {sender_username}",
                    "notification_actor_id":   self.scope['user'].id,
                    "notification_target_user_id": receiver_id,
                })
            else:
                event = {
                    "type":            "voice_note",
                    "sender_id":       self.scope["user"].id,
                    "message_id":      message_id,
                    "voice_url":       voice_url,
                    "duration":        duration,
                    "sender_username": sender_username,
                    "sender_avatar":   sender_avatar,
                    "created_at":      created_at,
                }
                await self.channel_layer.group_send(self.room_group_name, event)
            return

        # ── File message ──────────────────────────────────────────────
        if data.get("type") == "file_message":
            message_id      = data.get('message_id') or str(uuid.uuid4())
            sender_username = data.get("sender_username") or self.scope["user"].username
            sender_avatar   = data.get("sender_avatar") or '/static/Areeba.jpeg'
            created_at      = data.get("created_at") or time.strftime('%Y-%m-%dT%H:%M:%S.%fZ', time.gmtime())
            payload = {
                "type":            "file_message",
                "sender_id":       self.scope["user"].id,
                "message_id":      message_id,
                "file_id":         data.get('file_id'),
                "file_url":        data.get('file_url'),
                "original_name":   data.get('original_name'),
                "mime_type":       data.get('mime_type'),
                "file_size":       data.get('file_size'),
                "file_category":   data.get('file_category'),
                "sender_username": sender_username,
                "sender_avatar":   sender_avatar,
                "created_at":      created_at,
            }
            if data.get('dm') and data.get('receiver_id'):
                receiver_id = data.get('receiver_id')
                group = self.dm_group_name(self.scope["user"].id, receiver_id, self.workspace_id)
                payload['dm']          = True
                payload['receiver_id'] = receiver_id
                await self.channel_layer.group_send(group, payload)
                await self.channel_layer.group_send(self.room_group_name, {
                    "type":                    "notification_event",
                    "notification":            True,
                    "notification_section":    "dm",
                    "notification_type":       "dm_message",
                    "notification_message":    f"New DM from {sender_username}",
                    "notification_actor_id":   self.scope['user'].id,
                    "notification_target_user_id": receiver_id,
                })
            else:
                await self.channel_layer.group_send(self.room_group_name, payload)
            return

        # ── DM text message ───────────────────────────────────────────
        if data.get("dm") and data.get("receiver_id"):
            message = data.get("message")
            if not message or not message.strip():
                logger.warning(f"Empty DM message from {self.scope['user'].username}")
                return
            message_id  = data.get('message_id') or str(uuid.uuid4())
            receiver_id = data.get("receiver_id")
            username    = self.scope["user"].username
            user        = await self.get_user_data()
            try:
                saved = await self.save_dm(message, receiver_id)
                await self.create_dm_notification(receiver_id, self.scope["user"].id, user.get('display_name', username))
                group = self.dm_group_name(self.scope["user"].id, receiver_id, self.workspace_id)
                event = {
                    "type":            "chat_message",
                    "dm":              True,
                    "sender_id":       self.scope["user"].id,
                    "receiver_id":     receiver_id,
                    "message_id":      message_id,
                    "message":         message,
                    "username":        username,
                    "sender_username": user.get('display_name', username),
                    "sender_avatar":   user.get('avatar_url', '/static/Areeba.jpeg'),
                    "created_at":      saved['created_at'],
                }
                await self.channel_layer.group_send(group, event)
                await self.channel_layer.group_send(self.room_group_name, {
                    "type":                    "notification_event",
                    "notification":            True,
                    "notification_section":    "dm",
                    "notification_type":       "dm_message",
                    "notification_message":    f"New DM from {user.get('display_name', username)}",
                    "notification_actor_id":   self.scope['user'].id,
                    "notification_target_user_id": receiver_id,
                })
            except Exception as exc:
                logger.exception(f"dm send failed: {exc}")
            return

        # ── Workspace message (fallback) ──────────────────────────────
        message = data.get('message')
        if not message or not message.strip():
            logger.warning(f"Empty workspace message from {self.scope['user'].username}")
            return
        message_id = data.get('message_id') or str(uuid.uuid4())
        username   = self.scope["user"].username
        user       = await self.get_user_data()
        try:
            saved = await self.save_message(message, message_id)
            await self.create_chat_notifications(self.scope['user'].id)
            event = {
                "type":                    "chat_message",
                "notification":            True,
                "notification_section":    "chat",
                "notification_type":       "message",
                "message_id":              message_id,
                "message":                 message,
                "username":                username,
                "sender_id":               self.scope["user"].id,
                "sender_username":         user.get('display_name', username),
                "sender_avatar":           user.get('avatar_url', '/static/Areeba.jpeg'),
                "created_at":              saved['created_at'],
                "db_id":                   saved['id'],
            }
            await self.channel_layer.group_send(self.room_group_name, event)
            logger.info(f"group_send: workspace={self.workspace_id} from={username} message={message}")
        except Exception as exc:
            logger.exception(f"group_send failed for workspace={self.workspace_id}: {exc}")

    # ── Group event handlers ──────────────────────────────────────────

    async def chat_message(self, event):
        await self.send(text_data=json.dumps(event))

    async def voice_note(self, event):
        await self.send(text_data=json.dumps(event))

    async def file_message(self, event):
        await self.send(text_data=json.dumps(event))

    async def notification_event(self, event):
        await self.send(text_data=json.dumps(event))

    async def typing_indicator(self, event):
        await self.send(text_data=json.dumps(event))

    async def call_signal(self, event):
        """
        Forward call signals to every connected client except the caller.
        Uses user.id comparison — safe because Django sets scope["user"] on connect.
        """
        # Don't echo the signal back to the person who triggered it.
        if event.get('caller_id') == self.scope["user"].id:
            return

        await self.send(text_data=json.dumps({
            'type':         'call_signal',
            'signal':       event.get('signal'),
            'call_id':      event.get('call_id'),
            'call_type':    event.get('call_type'),
            'caller_id':    event.get('caller_id'),
            'caller_name':  event.get('caller_name'),
            'workspace_id': event.get('workspace_id'),
        }))

    # ── DB helpers ────────────────────────────────────────────────────

    @database_sync_to_async
    def get_user_data(self):
        user = self.scope["user"]
        avatar_url = "/static/Areeba.jpeg"
        if user.profile_picture:
            avatar_url = user.profile_picture_url
        return {'display_name': user.display_name, 'avatar_url': avatar_url}

    @database_sync_to_async
    def save_dm(self, message_text, receiver_id):
        try:
            ws = Workspace.objects.get(id=self.workspace_id)
        except Workspace.DoesNotExist:
            ws = None
        sender   = self.scope['user']
        receiver = CustomUser.objects.get(id=receiver_id)
        dm = DirectMessage.objects.create(workspace=ws, sender=sender, receiver=receiver, message=message_text)
        return {'id': dm.id, 'created_at': dm.created_at.isoformat()}

    @database_sync_to_async
    def create_dm_notification(self, receiver_id, sender_id, sender_name):
        Notification.objects.create(
            workspace_id=self.workspace_id,
            user_id=receiver_id,
            actor_id=sender_id,
            section='dm',
            notification_type='dm_message',
            message=f'New direct message from {sender_name}',
            reference_id=str(sender_id),
        )

    @database_sync_to_async
    def save_message(self, message_text, message_uuid):
        try:
            ws = Workspace.objects.get(id=self.workspace_id)
        except Workspace.DoesNotExist:
            ws = None
        sender = self.scope['user']
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

    @database_sync_to_async
    def create_chat_notifications(self, sender_id):
        recipients = WorkspaceMembership.objects.filter(
            workspace_id=self.workspace_id
        ).exclude(user_id=sender_id)
        Notification.objects.bulk_create([
            Notification(
                workspace_id=self.workspace_id,
                user_id=member.user_id,
                actor_id=sender_id,
                section='chat',
                notification_type='message',
                message='New workspace chat message',
            )
            for member in recipients
        ])


# ── Taskboard consumer ────────────────────────────────────────────────────────

class TaskboardConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        self.workspace_id        = self.scope['url_route']['kwargs']['workspace_id']
        self.taskboard_group_name = f"taskboard_{self.workspace_id}"
        self.workspace_group_name = f"workspace_{self.workspace_id}"

        user = self.scope['user']
        if not user.is_authenticated:
            await self.close()
            return

        await self.channel_layer.group_add(self.taskboard_group_name, self.channel_name)
        await self.channel_layer.group_add(self.workspace_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.taskboard_group_name, self.channel_name)
        await self.channel_layer.group_discard(self.workspace_group_name, self.channel_name)

    async def receive(self, text_data):
        return

    async def taskboard_event(self, event):
        await self.send(text_data=json.dumps(event))

    async def chat_message(self, event):
        await self.send(text_data=json.dumps(event))

    async def notification_event(self, event):
        await self.send(text_data=json.dumps(event))

    # FIX: was completely missing — signals sent to workspace_{id} group were
    # silently dropped for any user whose active socket was a TaskboardConsumer.
    async def call_signal(self, event):
        """Forward call signals to taskboard-page users, excluding the caller."""
        if event.get('caller_id') == self.scope["user"].id:
            return

        await self.send(text_data=json.dumps({
            'type':         'call_signal',
            'signal':       event.get('signal'),
            'call_id':      event.get('call_id'),
            'call_type':    event.get('call_type'),
            'caller_id':    event.get('caller_id'),
            'caller_name':  event.get('caller_name'),
            'workspace_id': event.get('workspace_id'),
        }))