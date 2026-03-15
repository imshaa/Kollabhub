from django.test import TestCase, override_settings
from channels.db import database_sync_to_async
from django.urls import reverse

from .models import CustomUser, Workspace, WorkspaceMembership


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
        self.assertEqual(resp.json(), [])

        # add some messages and request again
        from .models import Message
        Message.objects.create(workspace=self.public_ws, sender=self.admin, message="hello")
        Message.objects.create(workspace=self.public_ws, sender=self.user, message="world")
        resp = self.client.get(reverse("messages_api", args=[self.public_ws.id]))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 2)
        # ensure order is chronological (first message first)
        self.assertEqual(data[0]["message"], "hello")
        self.assertEqual(data[1]["message"], "world")

        # another user who is not a member should get 403
        other = CustomUser.objects.create_user(username="other", password="pass")
        self.client.login(username="other", password="pass")
        resp = self.client.get(reverse("messages_api", args=[self.public_ws.id]))
        self.assertEqual(resp.status_code, 403)

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

