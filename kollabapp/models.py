from django.db import models
from django.contrib.auth.models import AbstractUser
from django.conf import settings
import uuid
from .supabase_storage import create_signed_url
from django.utils import timezone
from datetime import timedelta
from django.db.models.signals import post_save
from django.dispatch import receiver

class CustomUser(AbstractUser):
    email = models.EmailField(unique=True)
    display_name = models.CharField(max_length=100, blank=True, null=True)
    bio = models.TextField(max_length=225, blank=True, null=True)
    profile_picture = models.CharField(max_length=500, blank=True, default="")
 
    STATUS_CHOICES = (
        ("online",  "Online"),
        ("away",    "Away"),
        ("busy",    "Busy"),
        ("offline", "Offline"),
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="offline")
 
    def __str__(self):
        return self.username
 
    @property
    def profile_picture_url(self):
        return create_signed_url(self.profile_picture) if self.profile_picture else None
 
 
class OTPVerification(models.Model):
    """
    Secure OTP storage with:
      - automatic expiry (10 minutes)
      - attempt counting (max 5 wrong guesses)
      - one active OTP per (email, purpose) pair
      - password stored as a hashed token, never plaintext
    """
    PURPOSE_CHOICES = (
        ("signup",          "Signup Verification"),
        ("forgot_password", "Password Reset"),
    )
 
    email      = models.EmailField(db_index=True)
    otp_code   = models.CharField(max_length=6)
    purpose    = models.CharField(max_length=20, choices=PURPOSE_CHOICES)
 
    # Temporary signup data — password is stored as Django's make_password hash,
    # never as plaintext.
    temp_data  = models.JSONField(default=dict, blank=True)
 
    is_verified    = models.BooleanField(default=False)
    attempts       = models.PositiveSmallIntegerField(default=0)  # wrong-guess counter
    created_at     = models.DateTimeField(auto_now_add=True)
    expires_at     = models.DateTimeField()
 
    class Meta:
        ordering = ["-created_at"]
        indexes  = [models.Index(fields=["email", "purpose"])]
 
    def __str__(self):
        return f"OTP({self.purpose}) for {self.email}"
 
    # ── convenience properties ──────────────────────────────────
 
    @property
    def is_expired(self):
        return timezone.now() > self.expires_at
 
    @property
    def is_locked(self):
        """Too many wrong attempts."""
        return self.attempts >= 5
 
    @property
    def is_usable(self):
        return not self.is_verified and not self.is_expired and not self.is_locked
 
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

    image = models.CharField(max_length=500, blank=True, default="")

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
    
    
    @property
    def image_url(self):
        return create_signed_url(self.image) if self.image else None


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

class WorkspaceCall(models.Model):
    """Tracks an active or recent call session for a workspace."""
    workspace   = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='calls')
    initiated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                     null=True, related_name='initiated_calls')
    room_name   = models.CharField(max_length=200, unique=True)
    room_url    = models.URLField(max_length=500)
    is_active   = models.BooleanField(default=True)
    call_type   = models.CharField(max_length=10, choices=[('voice','Voice'),('video','Video')], default='video')
    created_at  = models.DateTimeField(auto_now_add=True)
    ended_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.workspace.title} call by {self.initiated_by} at {self.created_at}"
    
class Message(models.Model):
    """Persist chat messages for a workspace (text or voice note)."""
    workspace    = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='messages')
    sender       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                     null=True, related_name='sent_messages')
    message      = models.TextField(blank=True, default='')   # blank for voice-only messages
    message_uuid = models.UUIDField(null=True, blank=True, db_index=True)
    # ── voice note ────────────────────────────────────────────────────────────
    voice_note   = models.CharField(max_length=500, null=True, blank=True, help_text='Supabase or local storage path')
    duration     = models.PositiveIntegerField(null=True, blank=True,
                                               help_text='Duration in seconds')
    created_at   = models.DateTimeField(auto_now_add=True)
 
    class Meta:
        ordering = ['created_at']
 
    def __str__(self):
        sender = self.sender.username if self.sender else 'unknown'
        label  = 'voice' if self.voice_note else self.message[:30]
        return f"{sender}@{self.workspace_id}: {label}"
 
class DirectMessage(models.Model):
    workspace  = models.ForeignKey(Workspace, on_delete=models.CASCADE,
                                   related_name='direct_messages')
    sender     = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                   related_name='sent_dms')
    receiver   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                   related_name='received_dms')
    message    = models.TextField(blank=True, default='')   # blank for voice-only messages
    # ── voice note ────────────────────────────────────────────────────────────
    voice_note = models.CharField(max_length=500, null=True, blank=True, help_text='Supabase or local storage path')
    duration   = models.PositiveIntegerField(null=True, blank=True,
                                              help_text='Duration in seconds')
    created_at = models.DateTimeField(auto_now_add=True)
 
    class Meta:
        ordering = ['created_at']
 
    def __str__(self):
        return f"{self.sender} → {self.receiver}"

class ChatFile(models.Model):
    """
    Stores metadata for files sent in workspace chat or DMs.
    Actual bytes live in Supabase (or local media fallback).
 
    file_category choices:
        'image'    — jpg / png / gif / webp  (≤ 2 MB)
        'video'    — mp4 / mov / webm        (≤ 25 MB)
        'document' — pdf / doc / xls / etc   (≤ 25 MB)
    """
 
    storage_path  = models.CharField(max_length=500)
    file_url      = models.TextField(blank=True, default='')   # cached signed URL
    original_name = models.CharField(max_length=255)
    mime_type     = models.CharField(max_length=120, blank=True, default='')
    file_size     = models.PositiveBigIntegerField(default=0, help_text='Bytes')
    file_category = models.CharField(max_length=20, default='document')
 
    workspace = models.ForeignKey(
        'Workspace', on_delete=models.CASCADE,
        related_name='chat_files', null=True, blank=True,
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='sent_chat_files',
    )
    # Exactly one of these two will be set:
    message = models.ForeignKey(
        'Message', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='files',
    )
    dm = models.ForeignKey(
        'DirectMessage', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='files',
    )
    receiver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='received_chat_files',
        help_text='Only set for DM files',
    )
    created_at = models.DateTimeField(auto_now_add=True)
 
    class Meta:
        ordering = ['created_at']
 
    def __str__(self):
        return f"{self.original_name} ({self.file_category}) by {self.sender_id}"
 
    def fresh_url(self, expires_in: int = 3600) -> str:
        """Return a fresh signed URL (re-signs if expired)."""
        from .supabase_storage import create_signed_url
        url = create_signed_url(self.storage_path, expires_in)
        if url and url != self.file_url:
            ChatFile.objects.filter(pk=self.pk).update(file_url=url)
            self.file_url = url
        return url or self.file_url

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
    token = models.CharField(max_length=100, blank=True, null=True, unique=True)

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

class AIMessage(models.Model):
    """
    Stores every turn of a user's AI conversation inside a workspace.
    Each row is one message — either the user's question or the AI's reply.
    History is scoped per (workspace, user) so each member gets their own
    private conversation thread within the workspace context.
    """
 
    ROLE_CHOICES = [
        ('user',      'User'),
        ('assistant', 'Assistant'),
    ]
 
    workspace  = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name='ai_messages',
    )
    user       = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='ai_messages',
        help_text='The workspace member who owns this conversation',
    )
    role       = models.CharField(
        max_length=10,
        choices=ROLE_CHOICES,
        help_text='"user" = human message, "assistant" = AI reply',
    )
    content    = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
 
    class Meta:
        ordering = ['created_at']
 
    def __str__(self):
        preview = self.content[:60]
        return f'[{self.role}] {self.user.username}@{self.workspace.title}: {preview}'
 
   
# ------------------------------- Taskboard -----------------------------------

class TaskList(models.Model):
    """A column/list on the taskboard. Each workspace has 4 defaults + user-added ones."""
    workspace  = models.ForeignKey("Workspace", on_delete=models.CASCADE, related_name="task_lists")
    name       = models.CharField(max_length=100)
    color      = models.CharField(max_length=20, default="#60a5fa")
    position   = models.PositiveIntegerField(default=0)   # for ordering
    is_default = models.BooleanField(default=False)        # default 4 cannot be deleted
 
    class Meta:
        ordering = ["position", "id"]
 
    def __str__(self):
        return f"{self.name} ({self.workspace.title})"
 
 
class Task(models.Model):
    PRIORITY_CHOICES = (
        ("low",    "Low"),
        ("medium", "Medium"),
        ("high",   "High"),
    )
 
    workspace   = models.ForeignKey("Workspace", on_delete=models.CASCADE, related_name="tasks")
    task_list   = models.ForeignKey("TaskList",  on_delete=models.CASCADE, related_name="tasks",
                                    null=True, blank=True)
    title       = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    priority    = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default="medium")
    assignee    = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="assigned_tasks"
    )
    complete    = models.BooleanField(default=False)
    created_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="created_tasks"
    )
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)
 
    class Meta:
        ordering = ["created_at"]
 
    def __str__(self):
        return f"{self.title} — {self.workspace.title}"
 
 
class TaskAttachment(models.Model):
    ATTACHMENT_TYPES = (
        ("image",    "Image"),
        ("video",    "Video"),
        ("document", "Document"),
        ("link",     "Link"),
    )
 
    # Limits (bytes)
    IMAGE_MAX    = 1  * 1024 * 1024   #  1 MB
    VIDEO_MAX    = 10 * 1024 * 1024   # 10 MB
    DOC_MAX      = 5  * 1024 * 1024   #  5 MB

    IMAGE_COUNT_MAX    = 10
    VIDEO_COUNT_MAX    = 5
    DOC_COUNT_MAX      = 5
    LINK_COUNT_MAX     = 5
 
    task          = models.ForeignKey("Task", on_delete=models.CASCADE, related_name="attachments")
    uploaded_by   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                      null=True, related_name="task_attachments")
    attachment_type = models.CharField(max_length=10, choices=ATTACHMENT_TYPES)
    file          = models.CharField(max_length=500, blank=True, default="")
    link_url      = models.URLField(max_length=500, blank=True, default="")
    original_name = models.CharField(max_length=255, blank=True, default="")
    file_size     = models.PositiveIntegerField(default=0)    # bytes
    created_at    = models.DateTimeField(auto_now_add=True)
 
    @property
    def url(self):
        return create_signed_url(self.file) if self.file else None
 
    class Meta:
        ordering = ["created_at"]
 
    def __str__(self):
        return f"{self.attachment_type}: {self.original_name or self.link_url}"
 
 
class TaskComment(models.Model):
    task       = models.ForeignKey("Task", on_delete=models.CASCADE, related_name="comments")
    author     = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                   related_name="task_comments")
    text       = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
 
    class Meta:
        ordering = ["created_at"]
 
    def __str__(self):
        return f"{self.author.username}: {self.text[:40]}"


# task settings ----------------

class TaskboardSettings(models.Model):
    """
    Per-workspace taskboard configuration.
    One record per workspace (created automatically on first access).
    """
 
    # Who can create / edit / delete tasks
    PERM_CHOICES = (
        ("all_members", "All Members"),
        ("admin_only",  "Admins Only"),
    )
 
    workspace = models.OneToOneField(
        "Workspace", on_delete=models.CASCADE, related_name="taskboard_settings"
    )
 
    # ── Task permissions ─────────────────────────────────────────────────────
    who_can_create_tasks  = models.CharField(max_length=20, choices=PERM_CHOICES, default="all_members")
    who_can_edit_tasks    = models.CharField(max_length=20, choices=PERM_CHOICES, default="all_members")
    who_can_delete_tasks  = models.CharField(max_length=20, choices=PERM_CHOICES, default="admin_only")
    who_can_move_tasks    = models.CharField(max_length=20, choices=PERM_CHOICES, default="all_members")
 
    # ── List permissions ─────────────────────────────────────────────────────
    who_can_create_lists  = models.CharField(max_length=20, choices=PERM_CHOICES, default="all_members")
    who_can_edit_lists    = models.CharField(max_length=20, choices=PERM_CHOICES, default="all_members")
    who_can_delete_lists  = models.CharField(max_length=20, choices=PERM_CHOICES, default="admin_only")
 
    # ── Attachment / comment permissions ─────────────────────────────────────
    who_can_attach_files  = models.CharField(max_length=20, choices=PERM_CHOICES, default="all_members")
    who_can_comment       = models.CharField(max_length=20, choices=PERM_CHOICES, default="all_members")
 
    # ── Board behaviour ──────────────────────────────────────────────────────
    allow_due_dates       = models.BooleanField(default=True)
    allow_task_priorities = models.BooleanField(default=True)
    allow_task_assignees  = models.BooleanField(default=True)
    allow_attachments     = models.BooleanField(default=True)
    allow_comments        = models.BooleanField(default=True)
    allow_task_desc       = models.BooleanField(default=True)
 
    # ── Notifications (stored, consumed by future email/push layer) ───────────
    notify_on_task_create  = models.BooleanField(default=True)
    notify_on_task_done    = models.BooleanField(default=True)
    notify_on_comment      = models.BooleanField(default=True)
    notify_on_assign       = models.BooleanField(default=True)
 
    # ── Limits ──────────────────────────────────────────────────────────────
    max_tasks_per_list    = models.PositiveIntegerField(default=0)   # 0 = unlimited
    max_lists             = models.PositiveIntegerField(default=0)   # 0 = unlimited
 
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="taskboard_settings_updated"
    )
 
    def __str__(self):
        return f"Taskboard settings — {self.workspace.title}"


class Notification(models.Model):
    SECTION_CHOICES = (
        ("chat", "Workspace Chat"),
        ("dm", "Direct Message"),
        ("taskboard", "Taskboard"),
    )

    workspace = models.ForeignKey(
        "Workspace", on_delete=models.CASCADE, related_name="notifications"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="generated_notifications"
    )
    section = models.CharField(max_length=20, choices=SECTION_CHOICES)
    notification_type = models.CharField(max_length=50)
    reference_id = models.CharField(max_length=100, blank=True, null=True)
    message = models.CharField(max_length=255)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["workspace", "user", "is_read"])]

    def __str__(self):
        return f"Notification({self.section}) to {self.user.username}: {self.message[:30]}"

