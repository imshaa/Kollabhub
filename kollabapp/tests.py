from django.test import TestCase, override_settings
from channels.db import database_sync_to_async
from django.urls import reverse
from urllib.parse import quote_plus

from .models import CustomUser, Workspace, WorkspaceMembership, WorkspaceJoinRequest, Notification


class WorkspaceJoinTests(TestCase):
    def setUp(self):
        # create a normal user and an admin user
        self.user = CustomUser.objects.create_user(
            username="user1", password="pass", email="user1@example.com"
        )
        self.admin = CustomUser.objects.create_user(
            username="admin", password="pass", email="admin@example.com"
        )

        # public workspace owned by admin
        self.public_ws = Workspace.objects.create(
            title="PublicWS",
            admin=self.admin,
            visibility="public",
        )
        WorkspaceMembership.objects.create(
            workspace=self.public_ws,
            user=self.admin,
            role="admin",
        )
        # also make the normal user a member so the public badge is visible
        WorkspaceMembership.objects.create(
            workspace=self.public_ws,
            user=self.user,
            role="member",
        )

        # private workspace owned by admin (user is NOT a member) – used for join tests
        self.private_ws = Workspace.objects.create(
            title="PrivateWS",
            admin=self.admin,
            visibility="private",
        )
        WorkspaceMembership.objects.create(
            workspace=self.private_ws,
            user=self.admin,
            role="admin",
        )

        # another private workspace where the user is a member (for visibility badge)
        self.private_member_ws = Workspace.objects.create(
            title="MyPrivateWS",
            admin=self.admin,
            visibility="private",
        )
        WorkspaceMembership.objects.create(
            workspace=self.private_member_ws,
            user=self.admin,
            role="admin",
        )
        WorkspaceMembership.objects.create(
            workspace=self.private_member_ws,
            user=self.user,
            role="member",
        )

        # public workspace with a team email set (user not a member initially)
        self.team_ws = Workspace.objects.create(
            title="TeamWS",
            admin=self.admin,
            visibility="public",
            team_email="team@acme.com",
        )
        WorkspaceMembership.objects.create(
            workspace=self.team_ws,
            user=self.admin,
            role="admin",
        )

    def login(self):
        self.client.login(username="user1", password="pass")

    def test_public_join_with_admin_email(self):
        self.login()
        resp = self.client.post(
            reverse("join_workspace_manual"),
            {"workspace_email": self.admin.email, "title": self.public_ws.title},
        )
        self.assertRedirects(resp, reverse("chatui", args=[self.public_ws.id]))
        self.assertTrue(
            WorkspaceMembership.objects.filter(
                workspace=self.public_ws, user=self.user
            ).exists()
        )

    def test_public_join_with_team_email(self):
        self.login()
        resp = self.client.post(
            reverse("join_workspace_manual"),
            {"workspace_email": self.team_ws.team_email, "title": self.team_ws.title},
        )
        self.assertRedirects(resp, reverse("chatui", args=[self.team_ws.id]))
        self.assertTrue(
            WorkspaceMembership.objects.filter(
                workspace=self.team_ws, user=self.user
            ).exists()
        )

    def test_team_workspace_rejects_admin_email(self):
        self.login()
        resp = self.client.post(
            reverse("join_workspace_manual"),
            {"workspace_email": self.admin.email, "title": self.team_ws.title},
            follow=True,
        )
        # should not have created a membership and should display error
        self.assertContains(resp, "Workspace not found", status_code=200)
        self.assertFalse(
            WorkspaceMembership.objects.filter(
                workspace=self.team_ws, user=self.user
            ).exists()
        )

    def test_private_workspace_cannot_be_joined(self):
        self.login()
        resp = self.client.post(
            reverse("join_workspace_manual"),
            {"workspace_email": self.admin.email, "title": self.private_ws.title},
            follow=True,
        )
        self.assertContains(resp, "private workspace", status_code=200)
        self.assertFalse(
            WorkspaceMembership.objects.filter(
                workspace=self.private_ws, user=self.user
            ).exists()
        )

    def test_profile_page_shows_visibility_badges(self):
        self.login()
        response = self.client.get(reverse("profile"))
        # expect at least one public and one private badge
        self.assertContains(response, "Public")
        self.assertContains(response, "Private")

    def test_workspace_join_requests_show_in_management_modal(self):
        admin_user = CustomUser.objects.create_user(username="admin2", password="pass", email="admin2@example.com")
        workspace = Workspace.objects.create(title="ApprovalSpace", admin=admin_user, visibility="private")
        WorkspaceMembership.objects.create(workspace=workspace, user=admin_user, role="admin")

        request_user = CustomUser.objects.create_user(username="requester", password="pass", email="requester@example.com")
        WorkspaceJoinRequest.objects.create(workspace=workspace, user=request_user, status="on_hold")

        self.client.login(username="admin2", password="pass")
        response = self.client.get(reverse("workspace"))

        self.assertContains(response, "ApprovalSpace")
        self.assertContains(response, "requester")
        self.assertContains(response, "Pending")

    def test_workspace_join_request_decision_approves_member_and_creates_membership(self):
        admin_user = CustomUser.objects.create_user(username="admin5", password="pass", email="admin5@example.com")
        workspace = Workspace.objects.create(title="DecisionSpace", admin=admin_user, visibility="private")
        WorkspaceMembership.objects.create(workspace=workspace, user=admin_user, role="admin")

        request_user = CustomUser.objects.create_user(username="requester4", password="pass", email="requester4@example.com")
        join_request = WorkspaceJoinRequest.objects.create(workspace=workspace, user=request_user, status="on_hold")

        self.client.login(username="admin5", password="pass")
        response = self.client.post(
            reverse("workspace_join_request_decision", args=[join_request.id]),
            {"action": "approve"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["status"], "approved")
        self.assertTrue(
            WorkspaceMembership.objects.filter(workspace=workspace, user=request_user).exists()
        )
        join_request.refresh_from_db()
        self.assertEqual(join_request.status, "approved")

    def test_workspace_join_request_creates_notification_for_admin(self):
        admin_user = CustomUser.objects.create_user(username="admin3", password="pass", email="admin3@example.com")
        workspace = Workspace.objects.create(title="NotifySpace", admin=admin_user, visibility="private")
        WorkspaceMembership.objects.create(workspace=workspace, user=admin_user, role="admin")

        request_user = CustomUser.objects.create_user(username="requester2", password="pass", email="requester2@example.com")
        WorkspaceJoinRequest.objects.create(workspace=workspace, user=request_user, status="on_hold")

        self.client.login(username="requester2", password="pass")
        response = self.client.post(
            reverse("join_workspace_manual"),
            {"workspace_email": admin_user.email, "title": workspace.title},
            follow=True,
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(Notification.objects.filter(user=admin_user, workspace=workspace).exists())

    def test_workspace_notifications_api_returns_admin_and_user_requests(self):
        admin_user = CustomUser.objects.create_user(username="admin4", password="pass", email="admin4@example.com")
        workspace = Workspace.objects.create(title="ApiNotifySpace", admin=admin_user, visibility="private")
        WorkspaceMembership.objects.create(workspace=workspace, user=admin_user, role="admin")

        request_user = CustomUser.objects.create_user(username="requester3", password="pass", email="requester3@example.com")
        WorkspaceJoinRequest.objects.create(workspace=workspace, user=request_user, status="on_hold")
        WorkspaceJoinRequest.objects.create(workspace=workspace, user=self.user, status="approved")

        self.client.login(username=admin_user.username, password="pass")
        response = self.client.get(reverse("workspace_notifications_api"))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["pending_count"], 1)
        self.assertGreaterEqual(len(payload["incoming_requests"]), 1)
        self.assertEqual(payload["incoming_requests"][0]["status_label"], "Pending")
        self.assertGreaterEqual(len(payload["user_requests"]), 1)

    def test_login_redirects_when_authenticated(self):
        self.login()
        resp = self.client.get(reverse("login"))
        self.assertRedirects(resp, reverse("profile"))

    def test_signup_redirects_to_profile(self):
        resp = self.client.post(
            reverse("signup"),
            {"username": "newuser", "email": "new@example.com", "password": "pass", "confirm_password": "pass"},
        )
        # should log in and go to profile
        self.assertRedirects(resp, reverse("profile"))
        self.assertTrue(CustomUser.objects.filter(username="newuser").exists())

    def test_profile_api_returns_data(self):
        self.login()
        response = self.client.get(reverse("profile_api"))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["display_name"], self.user.display_name)
        self.assertIn("status", data)

    def test_empty_profile_shows_create_card_instead_of_message(self):
        # create a fresh user with no workspace memberships
        fresh = CustomUser.objects.create_user(
            username="fresh", password="pass", email="fresh@example.com"
        )
        self.client.login(username="fresh", password="pass")
        response = self.client.get(reverse("profile"))
        self.assertContains(response, "id=\"createGridCard\"")
        self.assertNotContains(response, "You are not part of any workspace yet.")

    def test_profile_with_workspaces_does_not_show_grid_create_card(self):
        self.login()
        response = self.client.get(reverse("profile"))
        self.assertNotContains(response, "id=\"createGridCard\"")

    def test_messages_api_membership_and_history(self):
        # user1 is already a member of public_ws in setUp
        self.login()
        # no messages yet
        resp = self.client.get(reverse("messages_api", args=[self.public_ws.id]))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["messages"], [])
        self.assertFalse(data["has_more"])

        # add some messages and request again
        from .models import Message
        Message.objects.create(workspace=self.public_ws, sender=self.admin, message="hello")
        Message.objects.create(workspace=self.public_ws, sender=self.user, message="world")
        resp = self.client.get(reverse("messages_api", args=[self.public_ws.id]))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["messages"]), 2)
        self.assertFalse(data["has_more"])
        # ensure order is chronological (first message first)
        self.assertEqual(data["messages"][0]["message"], "hello")
        self.assertEqual(data["messages"][1]["message"], "world")

        # another user who is not a member should get 403
        other = CustomUser.objects.create_user(username="other", password="pass")
        self.client.login(username="other", password="pass")
        resp = self.client.get(reverse("messages_api", args=[self.public_ws.id]))
        self.assertEqual(resp.status_code, 403)

    def test_messages_api_cursor_pagination_returns_older_messages(self):
        self.login()
        from .models import Message
        messages = []
        for i in range(55):
            messages.append(Message.objects.create(
                workspace=self.public_ws,
                sender=self.admin if i % 2 == 0 else self.user,
                message=f"msg-{i:02d}"
            ))

        resp = self.client.get(reverse("messages_api", args=[self.public_ws.id]))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["messages"]), 50)
        self.assertTrue(data["has_more"])
        self.assertIsNotNone(data["next_cursor"])
        self.assertEqual(data["messages"][0]["message"], "msg-05")
        self.assertEqual(data["messages"][-1]["message"], "msg-54")

        resp2 = self.client.get(reverse("messages_api", args=[self.public_ws.id]) + f"?limit=10&before={quote_plus(data['next_cursor'])}")
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.json()
        self.assertEqual(len(data2["messages"]), 5)
        self.assertFalse(data2["has_more"])
        self.assertEqual(data2["messages"][0]["message"], "msg-00")

    def test_direct_messages_api_cursor_pagination_returns_old_dms(self):
        self.login()
        other = CustomUser.objects.create_user(username="otherdm", password="pass", email="otherdm@example.com")
        WorkspaceMembership.objects.create(workspace=self.public_ws, user=other, role="member")
        from .models import DirectMessage
        for i in range(53):
            if i % 2 == 0:
                sender = self.user
                receiver = other
            else:
                sender = other
                receiver = self.user
            DirectMessage.objects.create(
                workspace=self.public_ws,
                sender=sender,
                receiver=receiver,
                message=f"dm-{i:02d}"
            )

        resp = self.client.get(reverse("direct_messages_api", args=[self.public_ws.id, other.id]))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["messages"]), 50)
        self.assertTrue(data["has_more"])
        self.assertEqual(data["messages"][-1]["message"], "dm-52")

        resp2 = self.client.get(reverse("direct_messages_api", args=[self.public_ws.id, other.id]) + f"?limit=10&before={quote_plus(data['next_cursor'])}")
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.json()
        self.assertEqual(len(data2["messages"]), 3)
        self.assertFalse(data2["has_more"])
        self.assertEqual(data2["messages"][0]["message"], "dm-00")

    def test_update_profile_view_saves_fields(self):
        self.login()
        resp = self.client.post(
            reverse("update_profile"),
            {
                "username": "newname",
                "displayName": "New display",
                "bio": "hello there",
                "status": "away",
            },
            follow=True,
        )
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, "newname")
        self.assertEqual(self.user.display_name, "New display")
        self.assertEqual(self.user.bio, "hello there")
        self.assertEqual(self.user.status, "away")

    def test_update_profile_rejects_duplicate_username(self):
        CustomUser.objects.create_user(
            username="taken", password="pass", email="a@b.com"
        )
        self.login()
        resp = self.client.post(
            reverse("update_profile"),
            {"username": "taken", "displayName": "X"},
            follow=True,
        )
        self.assertContains(resp, "Username already taken.")
        self.user.refresh_from_db()
        self.assertNotEqual(self.user.username, "taken")


# channels tests require TransactionTestCase because of async/database interaction
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase
from kollabproject.asgi import application


@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
class ChatConsumerTests(TransactionTestCase):
    def setUp(self):
        # create a user and workspace membership synchronously (run in main thread)
        self.user = CustomUser.objects.create_user(
            username="wsuser", password="pass", email="wsuser@example.com"
        )
        self.ws = Workspace.objects.create(
            title="ChatWS",
            admin=self.user,
            visibility="public",
        )
        WorkspaceMembership.objects.create(
            workspace=self.ws, user=self.user, role="member"
        )

    async def test_message_broadcast_and_persistence(self):
        # prepare websocket communicator and attach authenticated user
        communicator = WebsocketCommunicator(application, f"/ws/chat/{self.ws.id}/")
        communicator.scope["user"] = self.user
        connected, _ = await communicator.connect()
        self.assertTrue(connected, "Websocket failed to connect")

        # send a message and expect to receive the same message back
        await communicator.send_json_to({"message": "hello world"})
        response = await communicator.receive_json_from()
        self.assertEqual(response.get("message"), "hello world")
        self.assertEqual(response.get("username"), self.user.username)

        # verify the message was saved to the database with the expected workspace
        from .models import Message
        msgs = await database_sync_to_async(list)(Message.objects.filter(workspace=self.ws))
        self.assertTrue(len(msgs) > 0)
        self.assertEqual(msgs[0].message, "hello world")

        await communicator.disconnect()

