from django.db import models
from django.contrib.auth.models import AbstractUser
from django.conf import settings
import uuid


class CustomUser(AbstractUser):
    email = models.EmailField(unique=True)

    display_name = models.CharField(max_length=100, blank=True, null=True)

    #  Replacing description with bio
    bio = models.TextField(max_length=225, blank=True, null=True)

    profile_picture = models.ImageField(upload_to="profile_pics/", blank=True, null=True)

    STATUS_CHOICES = (
        ("online", "Online"),
        ("away", "Away"),
        ("busy", "Busy"),
        ("offline", "Offline"),
    )

    status = models.CharField(
        max_length=10,
        choices=STATUS_CHOICES,
        default="offline"
    )

    def __str__(self):
        return self.username

class Workspace(models.Model):

    VISIBILITY_CHOICES = (
        ("public", "Public"),
        ("private", "Private"),
    )

    title = models.CharField(max_length=150)
    display_name = models.CharField(max_length=150, blank=True, null=True)
    description = models.TextField(max_length=225, blank=True, null=True)
    team_email = models.EmailField(blank=True, null=True)

    visibility = models.CharField(
        max_length=10,
        choices=VISIBILITY_CHOICES,
        default="public"
    )

    image = models.ImageField(upload_to="workspace_pics/", blank=True, null=True)

    admin = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="owned_workspaces"
    )

    invites_restricted_to_admins = models.BooleanField(default=True)
    
    message_retention_days = models.IntegerField(default=None, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("title", "admin")

    def __str__(self):
        return self.title
    



class WorkspaceMembership(models.Model):
    ROLE_CHOICES = (
        ("admin", "Admin"),
        ("member", "Member"),
    )

    workspace = models.ForeignKey("Workspace", on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workspace_memberships")
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default="member")
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("workspace", "user")  # prevents duplicate memberships

    def __str__(self):
        return f"{self.user.username} in {self.workspace.title} ({self.role})"


class Message(models.Model):
    """Persist chat messages for a workspace."""
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='sent_messages')
    message = models.TextField()
    message_uuid = models.UUIDField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        sender = self.sender.username if self.sender else 'unknown'
        return f"{sender}@{self.workspace_id}: {self.message[:30]}"
    

class DirectMessage(models.Model):

    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="direct_messages"
    )

    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_dms"
    )

    receiver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="received_dms"
    )

    message = models.TextField()

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.sender} → {self.receiver}"


class Invitation(models.Model):
    STATUS_CHOICES = (
        ("pending", "Pending"),
        ("accepted", "Accepted"),
    )

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="invitations")
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="sent_invitations")
    recipient_email = models.EmailField(blank=True, null=True)
    recipient_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name="received_invitations")
    role = models.CharField(max_length=10, choices=(("admin", "Admin"), ("member", "Member")), default="member")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        recipient = self.recipient_user.username if self.recipient_user else self.recipient_email
        return f"Invite to {recipient} for {self.workspace.title}"



class WorkspaceInvite(models.Model):

    workspace = models.ForeignKey("Workspace", on_delete=models.CASCADE)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    created_at = models.DateTimeField(auto_now_add=True)

    max_uses = models.IntegerField(default=25)
    uses = models.IntegerField(default=0)

    expires_at = models.DateTimeField(null=True, blank=True)

    is_active = models.BooleanField(default=True)