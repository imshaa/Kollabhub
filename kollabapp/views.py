from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth import authenticate, login, logout, get_user_model
from django.views.decorators.http import require_POST, require_GET, require_http_methods
from django.contrib import messages
from django.contrib import messages as django_messages
from django.contrib.auth.decorators import login_required
from django.conf import settings
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.core.mail import EmailMultiAlternatives
import logging
import requests as http_requests
import uuid
from .tasks import send_otp_email_task
from datetime import timedelta        # stdlib — NOT django
from django.utils import timezone
from pathlib import Path
import uuid as _uuid
from kollabapp.ai_assistant import get_response
from .supabase_storage import build_storage_path, create_signed_url, delete_file, upload_file
from .models import CustomUser, OTPVerification, WorkspaceCall
from .models import Workspace
from .models import WorkspaceMembership
from .models import Message
from .models import DirectMessage
from .models import Invitation
from .models import ChatFile
from .models import Task
from .models import TaskList, TaskComment, TaskAttachment, TaskboardSettings, Notification
from .models import WorkspaceInvite, AIMessage
from django.http import JsonResponse
import json, re, random, string
from django.db import models
from django.db.models import Q, Count
logger = logging.getLogger(__name__)

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth.hashers import make_password


User = get_user_model()  # This gets CustomUser



ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mp3"}
ALLOWED_DOC_EXTENSIONS = {".docx", ".pdf", ".doc", ".txt"}

def _has_allowed_extension(filename, allowed_extensions):
    return Path(filename).suffix.lower() in allowed_extensions

import mimetypes as _mimetypes
 
# -------------------- FOR CHAT PAGE FILE HANDLING --------------------- 
# ── constants ──────────────────────────────────────────────────────────────────
_IMAGE_MAX_BYTES    = 2  * 1024 * 1024   # 2 MB
_OTHER_MAX_BYTES    = 25 * 1024 * 1024   # 25 MB
 
_IMAGE_MIME_PREFIXES = ('image/',)
_VIDEO_MIME_PREFIXES = ('video/',)
 
_ALLOWED_MIME = {
    # images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    # video
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
    # documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv',
    'application/zip', 'application/x-zip-compressed',
}
 
 
def _categorise(mime: str) -> str:
    if mime.startswith('image/'):
        return 'image'
    if mime.startswith('video/'):
        return 'video'
    return 'document'
 
 
def _detect_mime(file_obj) -> str:
    """Best-effort MIME detection from file name + Django content_type."""
    guessed, _ = _mimetypes.guess_type(file_obj.name or '')
    return file_obj.content_type or guessed or 'application/octet-stream'
  
 
# ═══════════════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════════════
 
def _otp_request_too_frequent(email, purpose, cooldown_seconds=60):
    """True if an OTP was already created within the cooldown window."""
    cutoff = timezone.now() - timedelta(seconds=cooldown_seconds)
    return OTPVerification.objects.filter(
        email=email, purpose=purpose, created_at__gte=cutoff,
    ).exists()
 
 
def _send_otp_email_sync(subject, template_name, context, recipient_email):
    html_content = render_to_string(f"emails/{template_name}", context)
    plain_content = strip_tags(html_content)
    msg = EmailMultiAlternatives(
        subject=subject,
        body=plain_content,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[recipient_email],
    )
    msg.attach_alternative(html_content, "text/html")
    msg.send(fail_silently=False)


# def send_otp_email(subject, template_name, context, recipient_email):
#     try:
#         send_otp_email_task.delay(subject, template_name, context, recipient_email)
#     except Exception:
#         logger.exception(
#             "Celery task failed, sending OTP email synchronously for %s",
#             recipient_email,
#         )
#         _send_otp_email_sync(subject, template_name, context, recipient_email)

# ═══════════════════════════════════════════════════════════════════
#  EMAIL HELPER  (Fix 1 — sync fallback that actually fires)
# ═══════════════════════════════════════════════════════════════════

def send_otp_email(subject, template_name, context, recipient_email):
   

    if getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
        # Dev / eager mode: skip the broker entirely, send right now.
        _send_otp_email_sync(subject, template_name, context, recipient_email)
        return

    try:
        send_otp_email_task.delay(subject, template_name, context, recipient_email)
        logger.info("OTP email task queued for %s", recipient_email)
    except Exception:
        logger.exception(
            "Celery broker unreachable — sending OTP email synchronously for %s",
            recipient_email,
        )
        _send_otp_email_sync(subject, template_name, context, recipient_email)


 
 
def validate_password_strength(password):
    errors = []
    if len(password) < 8:
        errors.append("Password must be at least 8 characters long.")
    if not re.search(r'[A-Z]', password):
        errors.append("Must contain at least one uppercase letter.")
    if not re.search(r'[a-z]', password):
        errors.append("Must contain at least one lowercase letter.")
    if not re.search(r'\d', password):
        errors.append("Must contain at least one digit.")
    if not re.search(r'[!@#$%^&*()\-_=+\[\]{};:\'",.<>?/\\|`~]', password):
        errors.append("Must contain at least one special character.")
    return errors
 
 
def _generate_otp_code():
    return ''.join(random.choices(string.digits, k=6))
 
 
def create_otp(email, purpose, temp_data=None):
    """
    Delete ALL previous OTPs for (email, purpose), then create one
    that expires in 10 minutes.
    """
    OTPVerification.objects.filter(email=email, purpose=purpose).delete()
    return OTPVerification.objects.create(
        email=email,
        otp_code=_generate_otp_code(),
        purpose=purpose,
        temp_data=temp_data or {},
        expires_at=timezone.now() + timedelta(minutes=10),
    )
 
 
def verify_otp_code(email, otp_code, purpose):
    """
    Returns {"ok": True, "otp": <instance>}
          | {"ok": False, "error": "<message>"}
    """
    try:
        otp = OTPVerification.objects.get(
            email=email, purpose=purpose, is_verified=False,
        )
    except OTPVerification.DoesNotExist:
        return {"ok": False, "error": "No active code found. Please request a new one."}
    except OTPVerification.MultipleObjectsReturned:
        OTPVerification.objects.filter(
            email=email, purpose=purpose, is_verified=False
        ).delete()
        return {"ok": False, "error": "Session error. Please request a new code."}
 
    if otp.is_expired:
        otp.delete()
        return {"ok": False, "error": "This code has expired. Please request a new one."}
 
    if otp.is_locked:
        return {"ok": False, "error": "Too many incorrect attempts. Please request a new code."}
 
    if otp.otp_code != otp_code.strip():
        otp.attempts += 1
        otp.save(update_fields=["attempts"])
        remaining = max(0, 5 - otp.attempts)
        if remaining == 0:
            return {"ok": False, "error": "Too many incorrect attempts. Please request a new code."}
        return {
            "ok": False,
            "error": f"Incorrect code — {remaining} attempt{'s' if remaining != 1 else ''} remaining.",
        }
 
    otp.is_verified = True
    otp.save(update_fields=["is_verified"])
    return {"ok": True, "otp": otp}
 
 
# ═══════════════════════════════════════════════════════════════════
#  SIGNUP
# ═══════════════════════════════════════════════════════════════════

def signup_view(request):
    if request.user.is_authenticated:
        return redirect("workspace")

    if request.method == "POST":
        email            = request.POST.get("email", "").strip().lower()
        password         = request.POST.get("password", "")
        confirm_password = request.POST.get("confirm_password", "")
        username         = request.POST.get("username", "").strip()

        def err(msg):
            return render(request, "signup.html", {"error": msg, "email": email})

        # ── Validation ──────────────────────────────────────────────
        if not email:
            return err("Email address is required.")
        if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
            return err("Please enter a valid email address.")
        if CustomUser.objects.filter(email=email).exists():
            return err("This email is already registered. Please sign in.")

        pw_errors = validate_password_strength(password)
        if pw_errors:
            return err(pw_errors[0])
        if password != confirm_password:
            return err("Passwords do not match.")
        if username and CustomUser.objects.filter(username=username).exists():
            return err("That username is already taken.")
        if _otp_request_too_frequent(email, "signup"):
            return err("A verification code was sent recently. Please wait 60 seconds.")

        # ── Create OTP record (fast DB write) ───────────────────────
        otp = create_otp(
            email=email,
            purpose="signup",
            temp_data={
                "email":    email,
                "password": make_password(password),  # hashed — never plaintext
                "username": username,
            },
        )

        # ── Queue / send email — non-blocking in production ─────────
        # In production this returns as soon as the task is in Redis
        # (microseconds). The Celery worker delivers the email
        # asynchronously. If the broker is down, send_otp_email() falls
        # back to a direct SMTP call (≤ 10 s), still before the redirect.
        send_otp_email(
            subject="Verify your KollabHub account",
            template_name="verify_email.html",
            context={
                "otp":      otp.otp_code,
                "username": username or email.split("@")[0],
            },
            recipient_email=email,
        )

        # ── Redirect immediately ─────────────────────────────────────
        # The browser reaches the OTP page in < 1 s. The email typically
        # arrives within a few seconds of the worker processing the task.
        return redirect("signup_verify_otp", email=email)

    return render(request, "signup.html")

# def signup_view(request):
#     if request.user.is_authenticated:
#         return redirect("workspace")
 
#     if request.method == "POST":
#         email            = request.POST.get("email", "").strip().lower()
#         password         = request.POST.get("password", "")
#         confirm_password = request.POST.get("confirm_password", "")
#         username         = request.POST.get("username", "").strip()
 
#         def err(msg):
#             return render(request, "signup.html", {"error": msg, "email": email})
 
#         if not email:
#             return err("Email address is required.")
#         if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
#             return err("Please enter a valid email address.")
#         if CustomUser.objects.filter(email=email).exists():
#             return err("This email is already registered. Please sign in.")
 
#         pw_errors = validate_password_strength(password)
#         if pw_errors:
#             return err(pw_errors[0])
#         if password != confirm_password:
#             return err("Passwords do not match.")
#         if username and CustomUser.objects.filter(username=username).exists():
#             return err("That username is already taken.")
#         if _otp_request_too_frequent(email, "signup"):
#             return err("A verification code was sent recently. Please wait 60 seconds.")
 
#         otp = create_otp(
#             email=email,
#             purpose="signup",
#             temp_data={
#                 "email":    email,
#                 "password": make_password(password),  # hashed — never plaintext
#                 "username": username,
#             },
#         )
 
#         send_otp_email(
#             subject="Verify your KollabHub account",
#             template_name="verify_email.html",
#             context={"otp": otp.otp_code, "username": username or email.split("@")[0]},
#             recipient_email=email,
#         )
 
#         return redirect("signup_verify_otp", email=email)
 
#     return render(request, "signup.html")
 
 
def signup_verify_otp(request, email):
    if request.user.is_authenticated:
        return redirect("workspace")
 
    email = email.lower()
 
    if request.method == "POST":
        otp_code = request.POST.get("otp", "").strip()
 
        def err(msg):
            return render(request, "signup_verify_otp.html", {"error": msg, "email": email})
 
        if not otp_code or not otp_code.isdigit() or len(otp_code) != 6:
            return err("Please enter the full 6-digit code.")
 
        result = verify_otp_code(email, otp_code, "signup")
        if not result["ok"]:
            return err(result["error"])
 
        otp_obj = result["otp"]
        temp    = otp_obj.temp_data
 
        # Re-check in case email was registered between steps
        if CustomUser.objects.filter(email=email).exists():
            otp_obj.delete()
            return err("This email was registered while verifying. Please sign in.")
 
        # Build unique username
        base_username = temp.get("username") or email.split("@")[0]
        username      = base_username
        counter       = 1
        while CustomUser.objects.filter(username=username).exists():
            username = f"{base_username}{counter}"
            counter += 1
 
        # Create user — password already hashed
        user          = CustomUser(username=username, email=temp["email"])
        user.password = temp["password"]
        user.save()
 
        # Consume OTP
        otp_obj.delete()
 
        # Force-login (no need to re-authenticate since we just created the account)
        user.backend = "django.contrib.auth.backends.ModelBackend"
        login(request, user)
 
        messages.success(request, "Account created! Welcome to KollabHub.")
        return redirect("workspace")
 
    return render(request, "signup_verify_otp.html", {"email": email})
 
 
# ═══════════════════════════════════════════════════════════════════
#  LOGIN
# ═══════════════════════════════════════════════════════════════════
 
def login_view(request):
    if request.user.is_authenticated:
        return redirect("workspace")
 
    if request.method == "POST":
        identifier = request.POST.get("email_or_username", "").strip()
        password   = request.POST.get("password", "")
 
        if not identifier or not password:
            return render(request, "login.html",
                          {"error": "Email/username and password are both required."})
 
        user = None
        if "@" in identifier:
            try:
                user_obj = CustomUser.objects.get(email=identifier.lower())
                user = authenticate(request, username=user_obj.username, password=password)
            except CustomUser.DoesNotExist:
                pass
        else:
            user = authenticate(request, username=identifier, password=password)
 
        if user:
            login(request, user)
            return redirect("workspace")
 
        return render(request, "login.html",
                      {"error": "Invalid email/username or password."})
 
    return render(request, "login.html")
 
 
# ═══════════════════════════════════════════════════════════════════
#  FORGOT PASSWORD
# ═══════════════════════════════════════════════════════════════════
 
def forgot_password_view(request):
    if request.user.is_authenticated:
        return redirect("workspace")
 
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
 
    if request.method == "POST":
        email = request.POST.get("email", "").strip().lower()
 
        if not email:
            if is_ajax:
                return JsonResponse({"ok": False, "error": "Email is required."})
            return render(request, "login.html", {"error": "Email is required."})
 
        if _otp_request_too_frequent(email, "forgot_password"):
            msg = "A reset code was sent recently. Please wait 60 seconds."
            if is_ajax:
                return JsonResponse({"ok": False, "error": msg})
            return render(request, "login.html", {"error": msg})
 
        # Send only if email exists — but always redirect (no info leak)
        try:
            user = CustomUser.objects.get(email=email)
            otp  = create_otp(email=email, purpose="forgot_password")
            send_otp_email(
                subject="KollabHub — Password Reset Code",
                template_name="reset_password.html",
                context={
                    "otp":      otp.otp_code,
                    "username": user.display_name or user.username or email.split("@")[0],
                },
                recipient_email=email,
            )
        except CustomUser.DoesNotExist:
            pass  # silent — no enumeration
 
        if is_ajax:
            return JsonResponse({"ok": True})
        return redirect("forgot_password_verify_otp", email=email)
 
    return render(request, "login.html")
 
 
def forgot_password_verify_otp(request, email):
    if request.user.is_authenticated:
        return redirect("workspace")
 
    email = email.lower()
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
 
    if request.method == "POST":
        otp_code = request.POST.get("otp", "").strip()
 
        def err(msg, status=400):
            if is_ajax:
                return JsonResponse({"ok": False, "error": msg}, status=status)
            return render(request, "login.html",
                          {"error": msg, "email": email, "screen": "forgot_otp"})
 
        if not otp_code or not otp_code.isdigit() or len(otp_code) != 6:
            return err("Please enter the full 6-digit code.")
 
        result = verify_otp_code(email, otp_code, "forgot_password")
        if not result["ok"]:
            return err(result["error"])
 
        if is_ajax:
            return JsonResponse({"ok": True})
        return redirect("reset_password", email=email)
 
    return render(request, "login.html", {"email": email, "screen": "forgot_otp"})
 
 
def reset_password_view(request, email):
    if request.user.is_authenticated:
        return redirect("workspace")
 
    email = email.lower()
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
 
    # Gate: verified OTP must exist and not be expired
    try:
        otp = OTPVerification.objects.get(
            email=email, purpose="forgot_password", is_verified=True,
        )
    except OTPVerification.DoesNotExist:
        if is_ajax:
            return JsonResponse({"ok": False, "error": "Invalid or expired reset session. Please start over."}, status=400)
        return render(request, "login.html",
                      {"error": "Invalid or expired reset session. Please start over."})
 
    if otp.is_expired:
        otp.delete()
        if is_ajax:
            return JsonResponse({"ok": False, "error": "Reset session expired. Please request a new code."}, status=400)
        return render(request, "login.html",
                      {"error": "Reset session expired. Please request a new code."})
 
    if request.method == "POST":
        new_password     = request.POST.get("new_password", "")
        confirm_password = request.POST.get("confirm_password", "")
 
        def err(msg, status=400):
            if is_ajax:
                return JsonResponse({"ok": False, "error": msg}, status=status)
            return render(request, "login.html",
                          {"error": msg, "email": email, "screen": "reset"})
 
        if not new_password:
            return err("New password is required.")
 
        pw_errors = validate_password_strength(new_password)
        if pw_errors:
            return err(pw_errors[0])
        if new_password != confirm_password:
            return err("Passwords do not match.")
 
        try:
            user = CustomUser.objects.get(email=email)
            user.set_password(new_password)
            user.save()
        except CustomUser.DoesNotExist:
            return err("Account not found.")
 
        # Consume OTP — single use
        otp.delete()
 
        if is_ajax:
            return JsonResponse({"ok": True})
 
        messages.success(request, "Password reset successfully. Please sign in.")
        return redirect("login")
 
    return render(request, "login.html", {"email": email, "screen": "reset"})
 
 
# ── Resend OTP (AJAX) ──────────────────────────────────────────────
 
@require_POST
def resend_otp(request):
    """AJAX: POST JSON { "email": "...", "purpose": "signup|forgot_password" }"""
    try:
        body    = json.loads(request.body)
        email   = body.get("email", "").strip().lower()
        purpose = body.get("purpose", "").strip()
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({"ok": False, "error": "Invalid request."})
 
    if not email or purpose not in ("signup", "forgot_password"):
        return JsonResponse({"ok": False, "error": "Invalid request."})
 
    if _otp_request_too_frequent(email, purpose):
        return JsonResponse({"ok": False,
                             "error": "Please wait 60 seconds before requesting a new code."})
 
    if purpose == "signup":
        try:
            old = OTPVerification.objects.get(email=email, purpose="signup")
            temp_data = old.temp_data
        except OTPVerification.DoesNotExist:
            return JsonResponse({"ok": False,
                                 "error": "No pending signup found. Please start again."})
        otp = create_otp(email=email, purpose="signup", temp_data=temp_data)
        send_otp_email(
            subject="Verify your KollabHub account",
            template_name="verify_email.html",
            context={
                "otp":      otp.otp_code,
                "username": temp_data.get("username") or email.split("@")[0],
            },
            recipient_email=email,
        )
    else:
        try:
            user = CustomUser.objects.get(email=email)
        except CustomUser.DoesNotExist:
            return JsonResponse({"ok": True})  # silent
        otp = create_otp(email=email, purpose="forgot_password")
        send_otp_email(
            subject="KollabHub — Password Reset Code",
            template_name="reset_password.html",
            context={
                "otp":      otp.otp_code,
                "username": user.display_name or user.username or email.split("@")[0],
            },
            recipient_email=email,
        )
 
    return JsonResponse({"ok": True})
 
 
# ── Logout ─────────────────────────────────────────────────────────
 
def logout_view(request):
    logout(request)
    return redirect("home")
 
# -----------------------------Proile Logic -----------------------------------

@login_required
def profile(request):
    """
    Settings View – accessible from inside a workspace via ?workspace_id=X.
    Without workspace_id, redirects to workspace list so user picks a workspace first.
    """
    user = request.user
    workspace_id = request.GET.get("workspace_id")

    # Settings only makes sense in context of a workspace.
    # If no workspace_id given, send to workspace list.
    if not workspace_id:
        return redirect("workspace")

    workspace = get_object_or_404(Workspace, id=workspace_id)

    # Membership check
    memberships = WorkspaceMembership.objects.filter(user=user).select_related("workspace")
    user_membership = WorkspaceMembership.objects.filter(workspace=workspace, user=user).first()
    if not user_membership:
        messages.error(request, "You are not a member of this workspace.")
        return redirect("workspace")

    is_admin = (user_membership.role == "admin")

    # dm_members needed by base_layout sidebar
    members = WorkspaceMembership.objects.filter(workspace=workspace).select_related("user")
    dm_members = members.exclude(user=user)

    return render(request, "settings.html", {
        "user": user,
        "workspace": workspace,
        "is_admin": is_admin,
        "members": members,
        "dm_members": dm_members,
    })



@login_required
def update_profile(request):
    user = request.user

    if request.method == "POST":
        username = request.POST.get("username", "").strip()
        display_name = request.POST.get("displayName", "").strip()
        bio = request.POST.get("bio", "").strip()
        status = request.POST.get("status", "online")
        profile_picture = request.FILES.get("fileUpload")

        # optional username change
        if username and username != user.username:
            if CustomUser.objects.filter(username=username).exclude(pk=user.pk).exists():
                messages.error(request, "Username already taken.")
                return redirect(request.META.get("HTTP_REFERER", "profile"))
            user.username = username

        if not display_name:
            messages.error(request, "Display name is required.")
            return redirect(request.META.get("HTTP_REFERER", "profile"))

        user.display_name = display_name
        user.bio = bio
        user.status = status

        if profile_picture:
            if profile_picture.size > TaskAttachment.IMAGE_MAX:
                messages.error(request, "Profile image must be under 1 MB.")
                return redirect(request.META.get("HTTP_REFERER", "profile"))
            if not _has_allowed_extension(profile_picture.name, ALLOWED_IMAGE_EXTENSIONS):
                messages.error(request, "Profile image must be a PNG or JPG file.")
                return redirect(request.META.get("HTTP_REFERER", "profile"))
            old_path = user.profile_picture
            new_path = build_storage_path("profile_pics", profile_picture.name)
            upload_file(new_path, profile_picture, profile_picture.content_type)
            if old_path:
                delete_file(old_path)
            user.profile_picture = new_path

        user.save()
        return redirect(request.META.get("HTTP_REFERER", "profile"))

    return redirect("home")

# ---------- Profile Api --------------------
# simple profile data endpoint used for live updates
@login_required
def profile_api(request):
    user = request.user
    data = {
        "display_name": user.display_name,
        "bio": user.bio,
        "status": user.status,
        "profile_picture": user.profile_picture_url or "",
    }
    return JsonResponse(data)

#  ------------------------- Home Page ---------------------------------------
def home(request):
    return render(request, 'home.html')



# To check Workspace Admin.
def is_workspace_admin(user, workspace):
    return WorkspaceMembership.objects.filter(workspace=workspace, user=user, role="admin").exists()



# ------------------------------ Workspace-page logic---------------------------

@login_required
def workspace(request):

    if request.method == "POST":

        title = request.POST.get("title", "").strip()
        display_name = request.POST.get("display_name", "").strip()
        description = request.POST.get("description", "").strip()
        team_email = request.POST.get("team_email", "").strip()
        visibility = request.POST.get("visibility", "public")
        image = request.FILES.get("fileUpload")

        # Required fields validation
        if not title:
            messages.error(request, "Workspace title is required.")
            return redirect("workspace")

        image_path = None
        if image:
            if image.size > TaskAttachment.IMAGE_MAX:
                messages.error(request, "Workspace image must be under 1 MB.")
                return redirect("workspace")
            if not _has_allowed_extension(image.name, ALLOWED_IMAGE_EXTENSIONS):
                messages.error(request, "Workspace image must be a PNG or JPG file.")
                return redirect("workspace")
            image_path = build_storage_path("workspace_pics", image.name)
            upload_file(image_path, image, image.content_type)

        # NEW LIMIT: max 50 workspaces total (admin + member)
        total_memberships = WorkspaceMembership.objects.filter(
            user=request.user
        ).count()

        if total_memberships >= 50:
            messages.error(request, "You cannot be part of more than 50 workspaces.")
            return redirect("workspace")

        workspace, created = Workspace.objects.get_or_create(
            title=title,
            admin=request.user,
            defaults={
                "display_name": display_name if display_name else None,
                "description": description,
                "team_email": team_email if team_email else None,
                "visibility": visibility,
                "image": image_path or "",
            },
        )

        if not created:
            workspace.display_name = display_name if display_name else None
            workspace.description = description
            workspace.team_email = team_email if team_email else None
            workspace.visibility = visibility

            if image_path:
                old_path = workspace.image
                workspace.image = image_path
                if old_path:
                    delete_file(old_path)

            workspace.save()
        else:
            WorkspaceMembership.objects.create(
                workspace=workspace,
                user=request.user,
                role="admin"
            )

        return redirect("chatui", workspace_id=workspace.id)

    # GET request: Show workspace hub
    memberships = WorkspaceMembership.objects.filter(user=request.user).select_related("workspace")
    workspaces = [m.workspace for m in memberships]
    
    return render(request, "profile.html", {
        "workspaces": workspaces,
        "user": request.user
    })


@login_required
@require_POST
def update_workspace_info(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not _is_admin(workspace, request.user):
        return JsonResponse({"error": "Permission denied."}, status=403)

    title = request.POST.get("title", "").strip()
    display_name = request.POST.get("display_name", "").strip()
    image = request.FILES.get("fileUpload")
    changed = False

    if title and title != workspace.title:
        if Workspace.objects.filter(admin=request.user, title=title).exclude(pk=workspace.pk).exists():
            return JsonResponse({"error": "You already have a workspace with that title."}, status=400)
        workspace.title = title
        changed = True

    if display_name != (workspace.display_name or ""):
        workspace.display_name = display_name if display_name else None
        changed = True

    if image:
        if image.size > TaskAttachment.IMAGE_MAX:
            return JsonResponse({"error": "Workspace image must be under 1 MB."}, status=400)
        if not _has_allowed_extension(image.name, ALLOWED_IMAGE_EXTENSIONS):
            return JsonResponse({"error": "Workspace image must be a PNG or JPG file."}, status=400)
        new_path = build_storage_path("workspace_pics", image.name)
        upload_file(new_path, image, image.content_type)
        if workspace.image:
            delete_file(workspace.image)
        workspace.image = new_path
        changed = True

    if not changed:
        return JsonResponse({"error": "No changes were submitted."}, status=400)

    workspace.save()
    return JsonResponse({
        "success": True,
        "title": workspace.title,
        "display_name": workspace.display_name or "",
        "image_url": workspace.image_url,
    })


# Joining members to a workspace
@login_required
def join_workspace_manual(request):

    if request.method == "POST":

        email = request.POST.get("workspace_email", "").strip().lower()
        title = request.POST.get("title")

        try:
            workspace = Workspace.objects.get(title=title)
        except Workspace.DoesNotExist:
            messages.error(request, "Workspace not found.")
            return redirect("profile")

        if workspace.team_email:
            if email != workspace.team_email.lower():
                messages.error(request, "Workspace not found.")
                return redirect("profile")
        else:
            if email != workspace.admin.email.lower():
                messages.error(request, "Workspace not found.")
                return redirect("profile")

        # Check if user is already a member
        if WorkspaceMembership.objects.filter(workspace=workspace, user=request.user).exists():
            messages.info(request, f"You are already a member of {workspace.title}.")
            return redirect("chatui", workspace_id=workspace.id)

        # 50 workspace limit
        total_memberships = WorkspaceMembership.objects.filter(
            user=request.user
        ).count()

        if total_memberships >= 50:
            messages.error(request, "You cannot join more than 50 workspaces.")
            return redirect("profile")

        # Direct membership for both public and private workspaces.
        membership, created = WorkspaceMembership.objects.get_or_create(
            workspace=workspace,
            user=request.user,
            defaults={"role": "member"}
        )

        if created:
            messages.success(request, f"Joined workspace {workspace.title}!")
        else:
            messages.info(request, f"You are already a member of {workspace.title}.")

        return redirect("chatui", workspace_id=workspace.id)

    return redirect("profile")




# ----------------------------Chatpage Logic--------------------------------------

@login_required
def chatui(request, workspace_id):

    membership = WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).first()

    if not membership:
        messages.error(request, "You are not part of this workspace.")
        return redirect("workspace")

    workspace = membership.workspace

    members = WorkspaceMembership.objects.filter(
        workspace=workspace
    ).select_related("user")

    # exclude yourself from DM list
    dm_members = members.exclude(user=request.user)

    notification_counts = _get_notification_counts(workspace, request.user)

    return render(request, "chatui.html", {
        "workspace": workspace,
        "members": members,
        "dm_members": dm_members,
        "notification_counts": notification_counts,
        "notification_counts_json": json.dumps(notification_counts),
    })


# ── workspace chat file upload ─────────────────────────────────────────────────
@login_required
def upload_chat_file(request, workspace_id):
    """
    POST /api/workspace/<workspace_id>/upload-file/
    Form fields: file (multipart), message_uuid (optional str)
    Returns JSON with file metadata for WS broadcast.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
 
    if not WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).exists():
        return JsonResponse({'error': 'not a member'}, status=403)
 
    uploaded = request.FILES.get('file')
    if not uploaded:
        return JsonResponse({'error': 'No file provided'}, status=400)
 
    mime      = _detect_mime(uploaded)
    category  = _categorise(mime)
    file_size = uploaded.size
 
    # ── validation ────────────────────────────────────────────────────────────
    if mime not in _ALLOWED_MIME:
        return JsonResponse({'error': f'File type "{mime}" is not allowed.'}, status=400)
 
    if category == 'image' and file_size > _IMAGE_MAX_BYTES:
        return JsonResponse({'error': 'Images must be smaller than 2 MB.'}, status=400)
 
    if category != 'image' and file_size > _OTHER_MAX_BYTES:
        return JsonResponse({'error': 'Files must be smaller than 25 MB.'}, status=400)
 
    # ── store in Supabase ─────────────────────────────────────────────────────
    folder       = f'chat_files/workspace/{workspace_id}/{category}'
    storage_path = build_storage_path(folder, uploaded.name)
 
    try:
        upload_file(storage_path, uploaded, content_type=mime)
    except Exception as exc:
        logger.exception('Supabase upload error: %s', exc)
        return JsonResponse({'error': 'File upload failed. Please try again.'}, status=500)
 
    signed_url = create_signed_url(storage_path, expires_in=3600 * 24) or ''
 
    # ── save workspace message + ChatFile ─────────────────────────────────────
    workspace    = get_object_or_404(Workspace, id=workspace_id)
    message_uuid_str = request.POST.get('message_uuid') or str(_uuid.uuid4())
    try:
        parsed_uuid = _uuid.UUID(str(message_uuid_str))
    except Exception:
        parsed_uuid = _uuid.uuid4()
 
    msg = Message.objects.create(
        workspace=workspace,
        sender=request.user,
        message='',            # file-only; no text body
        message_uuid=parsed_uuid,
    )
 
    chat_file = ChatFile.objects.create(
        workspace=workspace,
        sender=request.user,
        message=msg,
        storage_path=storage_path,
        file_url=signed_url,
        original_name=uploaded.name,
        mime_type=mime,
        file_size=file_size,
        file_category=category,
    )
 
    # ── build response ────────────────────────────────────────────────────────
    avatar_url = '/static/Areeba.jpeg'
    if request.user.profile_picture:
        avatar_url = request.user.profile_picture_url
 
    return JsonResponse({
        'success':              True,
        'file_id':              chat_file.id,
        'file_url':             signed_url,
        'storage_path':         storage_path,
        'original_name':        uploaded.name,
        'mime_type':            mime,
        'file_size':            file_size,
        'file_category':        category,
        'message_id':           str(msg.message_uuid),
        'db_id':                msg.id,
        'sender_id':            request.user.id,
        'sender_username':      request.user.username,
        'sender_display_name':  getattr(request.user, 'display_name', request.user.username),
        'sender_avatar':        avatar_url,
        'created_at':           msg.created_at.isoformat(),
    })
 

# ── DM file upload ─────────────────────────────────────────────────────────────
@login_required
def upload_dm_file(request, workspace_id):
    """
    POST /api/workspace/<workspace_id>/upload-dm-file/
    Form fields: file (multipart), receiver_id (int)
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
 
    if not WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).exists():
        return JsonResponse({'error': 'not a member'}, status=403)
 
    uploaded    = request.FILES.get('file')
    receiver_id = request.POST.get('receiver_id')
 
    if not uploaded:
        return JsonResponse({'error': 'No file provided'}, status=400)
    if not receiver_id:
        return JsonResponse({'error': 'receiver_id required'}, status=400)
 
    try:
        receiver_id = int(receiver_id)
    except (ValueError, TypeError):
        return JsonResponse({'error': 'Invalid receiver_id'}, status=400)
 
    mime      = _detect_mime(uploaded)
    category  = _categorise(mime)
    file_size = uploaded.size
 
    if mime not in _ALLOWED_MIME:
        return JsonResponse({'error': f'File type "{mime}" is not allowed.'}, status=400)
 
    if category == 'image' and file_size > _IMAGE_MAX_BYTES:
        return JsonResponse({'error': 'Images must be smaller than 2 MB.'}, status=400)
 
    if category != 'image' and file_size > _OTHER_MAX_BYTES:
        return JsonResponse({'error': 'Files must be smaller than 25 MB.'}, status=400)
 
    folder       = f'chat_files/dm/{workspace_id}/{category}'
    storage_path = build_storage_path(folder, uploaded.name)
 
    try:
        upload_file(storage_path, uploaded, content_type=mime)
    except Exception as exc:
        logger.exception('Supabase DM upload error: %s', exc)
        return JsonResponse({'error': 'File upload failed. Please try again.'}, status=500)
 
    signed_url = create_signed_url(storage_path, expires_in=3600 * 24) or ''
 
    workspace = get_object_or_404(Workspace, id=workspace_id)
    receiver  = get_object_or_404(CustomUser, id=receiver_id)
 
    dm = DirectMessage.objects.create(
        workspace=workspace,
        sender=request.user,
        receiver=receiver,
        message='',
    )
 
    chat_file = ChatFile.objects.create(
        workspace=workspace,
        sender=request.user,
        dm=dm,
        receiver=receiver,
        storage_path=storage_path,
        file_url=signed_url,
        original_name=uploaded.name,
        mime_type=mime,
        file_size=file_size,
        file_category=category,
    )
 
    avatar_url = '/static/Areeba.jpeg'
    if request.user.profile_picture:
        avatar_url = request.user.profile_picture_url
 
    return JsonResponse({
        'success':              True,
        'file_id':              chat_file.id,
        'file_url':             signed_url,
        'storage_path':         storage_path,
        'original_name':        uploaded.name,
        'mime_type':            mime,
        'file_size':            file_size,
        'file_category':        category,
        'message_id':           str(_uuid.uuid4()),
        'db_id':                dm.id,
        'sender_id':            request.user.id,
        'sender_username':      request.user.username,
        'sender_display_name':  getattr(request.user, 'display_name', request.user.username),
        'sender_avatar':        avatar_url,
        'created_at':           dm.created_at.isoformat(),
    })
 
 
# ── refresh a signed URL (called by client when URL might be expired) ──────────
@login_required
def refresh_file_url(request, file_id):
    """
    GET /api/chat-file/<file_id>/refresh-url/
    Returns { url } with a fresh signed URL.
    """
    try:
        cf = ChatFile.objects.get(pk=file_id)
    except ChatFile.DoesNotExist:
        return JsonResponse({'error': 'not found'}, status=404)
 
    # basic access check: sender, receiver, or workspace member
    if cf.sender_id != request.user.id:
        if cf.receiver_id and cf.receiver_id != request.user.id:
            return JsonResponse({'error': 'forbidden'}, status=403)
        if cf.workspace_id:
            if not WorkspaceMembership.objects.filter(
                user=request.user, workspace_id=cf.workspace_id
            ).exists():
                return JsonResponse({'error': 'forbidden'}, status=403)
 
    return JsonResponse({'url': cf.fresh_url()})

#  ---------------------   Messages API LOgic -------------------------

@login_required
def messages_api(request, workspace_id):
    """Return recent messages for a workspace as JSON.

    URL: /api/workspace/<workspace_id>/messages/?limit=100
    """
    # membership check
    if not WorkspaceMembership.objects.filter(user=request.user, workspace_id=workspace_id).exists():
        return JsonResponse({'error': 'not a member'}, status=403)

    # Clean up old messages if retention policy is set
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if workspace.message_retention_days:
        from datetime import timedelta
        from django.utils import timezone
        cutoff_date = timezone.now() - timedelta(days=workspace.message_retention_days)
        Message.objects.filter(workspace=workspace, created_at__lt=cutoff_date).delete()

    # allow caller to limit number of messages (defaults to 100)
    try:
        limit = int(request.GET.get('limit', 100))
    except ValueError:
        limit = 100

    msgs = (
        Message.objects.filter(workspace_id=workspace_id)
        .prefetch_related('files')         
        .order_by('created_at')[:limit]
    )

    # serialize in chronological order (oldest first)
    data = []
    for m in msgs:
        data.append({
    'id':                   m.id,
    'message_id':           str(m.message_uuid) if m.message_uuid else None,
    'message':              m.message or '',
    'sender_id':            m.sender.id if m.sender else None,
    'sender_username':      m.sender.username if m.sender else None,
    'sender_display_name':  getattr(m.sender, 'display_name', None) if m.sender else None,
    'sender_avatar':        m.sender.profile_picture_url if (m.sender and m.sender.profile_picture) else '/static/Areeba.jpeg',
    'created_at':           m.created_at.isoformat(),
    'voice_url':            resolve_voice_url(request, m.voice_note) if m.voice_note else None,
    'duration':             m.duration or 0,
    # ── NEW: file attachments ─────────────────────────────────────────────
    'files': [
        {
            'file_id':       f.id,
            'file_url':      f.fresh_url(),
            'original_name': f.original_name,
            'mime_type':     f.mime_type,
            'file_size':     f.file_size,
            'file_category': f.file_category,
        }
        for f in m.files.all()
    ],
})


    return JsonResponse(data, safe=False)


@login_required
def direct_messages_api(request, workspace_id, user_id):

    if not WorkspaceMembership.objects.filter(
        user=request.user,
        workspace_id=workspace_id
    ).exists():
        return JsonResponse({"error": "not allowed"}, status=403)

    messages = DirectMessage.objects.filter(
        workspace_id=workspace_id
    ).filter(
        Q(sender=request.user, receiver_id=user_id) |
        Q(sender_id=user_id, receiver=request.user)
    ).prefetch_related('files').order_by("created_at")

    data = []

    for m in messages:
         data.append({
        'id':        m.id,
        'message':   m.message or '',
        'sender_id': m.sender_id,
        'sender':    m.sender.username,
        'created_at': m.created_at.isoformat(),
        'voice_url': resolve_voice_url(request, m.voice_note) if m.voice_note else None,
        'duration':  m.duration or 0,
        'files': [
            {
                'file_id':       f.id,
                'file_url':      f.fresh_url(),
                'original_name': f.original_name,
                'mime_type':     f.mime_type,
                'file_size':     f.file_size,
                'file_category': f.file_category,
            }
            for f in m.files.all()
        ],
    })

    return JsonResponse(data, safe=False)

@login_required
def send_dm(request, workspace_id):

    data = json.loads(request.body)

    receiver_id = data.get("receiver_id")
    message = data.get("message")

    if not WorkspaceMembership.objects.filter(
        user=request.user,
        workspace_id=workspace_id
    ).exists():
        return JsonResponse({"error":"not allowed"}, status=403)

    dm = DirectMessage.objects.create(
        workspace_id=workspace_id,
        sender=request.user,
        receiver_id=receiver_id,
        message=message
    )

    return JsonResponse({"success":True})


# --------------------- Voice Notes _--------------------------------


def resolve_voice_url(request, voice_note):
    if not voice_note:
        return None

    # Support both stored path string and old FileField objects
    if hasattr(voice_note, 'url'):
        try:
            return request.build_absolute_uri(voice_note.url)
        except Exception:
            pass

    voice_path = str(voice_note).lstrip('/')
    if not voice_path:
        return None

    voice_url = create_signed_url(voice_path)
    if voice_url:
        return voice_url

    return request.build_absolute_uri(f'/media/{voice_path}') 


@login_required
def send_voice_note(request, workspace_id):
    """
    POST /api/workspace/<workspace_id>/send-voice-note/
    Multipart form: audio (file), duration (int, seconds), message_uuid (optional str)
    Returns: { success, voice_url, message_id, sender_username, sender_display_name,
                sender_avatar, sender_id, created_at, duration }
    The view saves the file to DB and returns metadata.
    The WebSocket broadcast is handled client-side after the HTTP response.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
 
    if not WorkspaceMembership.objects.filter(user=request.user, workspace_id=workspace_id).exists():
        return JsonResponse({'error': 'not a member'}, status=403)
 
    audio_file  = request.FILES.get('audio')
    duration    = request.POST.get('duration', 0)
    message_uuid_str = request.POST.get('message_uuid') or str(_uuid.uuid4())
 
    if not audio_file:
        return JsonResponse({'error': 'No audio file provided'}, status=400)
 
    try:
        duration = int(float(duration))
    except (ValueError, TypeError, OverflowError):
        duration = 0
 
    try:
        parsed_uuid = _uuid.UUID(str(message_uuid_str))
    except Exception:
        parsed_uuid = _uuid.uuid4()
 
    workspace = get_object_or_404(Workspace, id=workspace_id)
    
    # Upload voice note to Supabase (with local fallback)
    voice_path = build_storage_path('voice_notes/workspace', f'voice_{parsed_uuid}.webm')
    upload_file(voice_path, audio_file, 'audio/webm')
    
    msg = Message.objects.create(
        workspace=workspace,
        sender=request.user,
        message='',                 # voice-only; no text
        message_uuid=parsed_uuid,
        voice_note=voice_path,      # store the path, not the file
        duration=duration,
    )
 
    avatar_url = '/static/Areeba.jpeg'
    if request.user.profile_picture:
        avatar_url = request.user.profile_picture_url
    
    # Get signed URL from Supabase or local
    voice_url = create_signed_url(voice_path)
    if not voice_url:
        voice_url = request.build_absolute_uri(f'/media/{voice_path}')
 
    return JsonResponse({
        'success':              True,
        'voice_url':            voice_url,
        'message_id':           str(msg.message_uuid),
        'db_id':                msg.id,
        'sender_id':            request.user.id,
        'sender_username':      request.user.username,
        'sender_display_name':  getattr(request.user, 'display_name', request.user.username),
        'sender_avatar':        avatar_url,
        'created_at':           msg.created_at.isoformat(),
        'duration':             msg.duration or 0,
    })
 
 
@login_required
def send_dm_voice_note(request, workspace_id):
    """
    POST /api/workspace/<workspace_id>/send-dm-voice-note/
    Multipart form: audio (file), receiver_id (int), duration (int, seconds)
    Returns: { success, voice_url, message_id, sender_*, created_at, duration }
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
 
    if not WorkspaceMembership.objects.filter(user=request.user, workspace_id=workspace_id).exists():
        return JsonResponse({'error': 'not a member'}, status=403)
 
    audio_file  = request.FILES.get('audio')
    receiver_id = request.POST.get('receiver_id')
    duration    = request.POST.get('duration', 0)
 
    if not audio_file:
        return JsonResponse({'error': 'No audio file provided'}, status=400)
    if not receiver_id:
        return JsonResponse({'error': 'receiver_id required'}, status=400)
 
    try:
        receiver_id = int(receiver_id)
        duration    = int(float(duration))
    except (ValueError, TypeError, OverflowError):
        return JsonResponse({'error': 'Invalid receiver_id or duration'}, status=400)
 
    workspace = get_object_or_404(Workspace, id=workspace_id)
    receiver  = get_object_or_404(CustomUser, id=receiver_id)
    
    # Upload voice note to Supabase (with local fallback)
    voice_uuid = _uuid.uuid4()
    voice_path = build_storage_path('voice_notes/dm', f'voice_{voice_uuid}.webm')
    upload_file(voice_path, audio_file, 'audio/webm')
 
    dm = DirectMessage.objects.create(
        workspace=workspace,
        sender=request.user,
        receiver=receiver,
        message='',
        voice_note=voice_path,      # store the path, not the file
        duration=duration,
    )
 
    avatar_url = '/static/Areeba.jpeg'
    if request.user.profile_picture:
        avatar_url = request.user.profile_picture_url
    
    # Get signed URL from Supabase or local
    voice_url = create_signed_url(voice_path)
    if not voice_url:
        voice_url = request.build_absolute_uri(f'/media/{voice_path}')
 
    return JsonResponse({
        'success':              True,
        'voice_url':            voice_url,
        'message_id':           str(_uuid.uuid4()),   # unique id for dedup
        'db_id':                dm.id,
        'sender_id':            request.user.id,
        'sender_username':      request.user.username,
        'sender_display_name':  getattr(request.user, 'display_name', request.user.username),
        'sender_avatar':        avatar_url,
        'created_at':           dm.created_at.isoformat(),
        'duration':             dm.duration or 0,
    })

#  ----------------------- CHAT CALLS -----------------------------
# ── Daily.co helpers ──────────────────────────────────────────────
 
def _daily_headers():
    return {
        'Authorization': f'Bearer {settings.DAILY_API_KEY}',
        'Content-Type': 'application/json',
    }
 
def _create_daily_room(workspace_id, call_type='video'):
    """
    Create a Daily.co room.
    Using 'public' privacy so participants can join with a meeting token OR
    directly via URL — avoids the private-room token-exchange CORS issue
    that causes join() to reject in the browser.
    The room is still protected by a short expiry (2 hours).
    Returns (room_name, room_url).
    """
    short_id  = uuid.uuid4().hex[:8]
    room_name = f'kh-{workspace_id}-{short_id}'   # e.g. kh-2-a3f1b2c4
 
    exp_ts = int((timezone.now() + timedelta(hours=2)).timestamp())
 
    payload = {
        'name': room_name,
        'privacy': 'public',          # ← changed from 'private'
        'properties': {
            'exp':                exp_ts,
            'enable_screenshare': True,
            'start_video_off':    call_type == 'voice',
            'start_audio_off':    False,
            # Do NOT include max_participants — not available on free plan
        }
    }
 
    resp = http_requests.post(
        f'{settings.DAILY_API_URL}/rooms',
        json=payload,
        headers=_daily_headers(),
        timeout=10,
    )
 
    if not resp.ok:
        try:    err_body = resp.json()
        except: err_body = resp.text
        raise Exception(f'Daily API {resp.status_code}: {err_body}')
 
    data = resp.json()
    return data['name'], data['url']
 
def _create_daily_token(room_name, display_name, is_owner=False):
    """
    Create a meeting token so participants appear with their display name
    and the owner gets meeting controls.
    Still useful even for public rooms.
    """
    exp_ts = int((timezone.now() + timedelta(hours=2)).timestamp())
 
    payload = {
        'properties': {
            'room_name':          room_name,
            'user_name':          display_name,
            'exp':                exp_ts,
            'is_owner':           is_owner,
            'enable_screenshare': True,
            'start_video_off':    False,
            'start_audio_off':    False,
        }
    }
 
    resp = http_requests.post(
        f'{settings.DAILY_API_URL}/meeting-tokens',
        json=payload,
        headers=_daily_headers(),
        timeout=10,
    )
 
    if not resp.ok:
        try:    err_body = resp.json()
        except: err_body = resp.text
        raise Exception(f'Daily token API {resp.status_code}: {err_body}')
 
    return resp.json()['token']
 
 
def _delete_daily_room(room_name):
    """Delete a Daily.co room (best-effort, ignore errors)."""
    try:
        http_requests.delete(
            f'{settings.DAILY_API_URL}/rooms/{room_name}',
            headers=_daily_headers(),
            timeout=5,
        )
    except Exception:
        pass


def _check_daily_room_exists(room_name):
    """Return True if the Daily room still exists, False if it is deleted, None if unknown."""
    try:
        resp = http_requests.get(
            f'{settings.DAILY_API_URL}/rooms/{room_name}',
            headers=_daily_headers(),
            timeout=5,
        )
    except Exception as exc:
        logger.warning(f'check_daily_room_exists failed: {exc}')
        return None

    if resp.status_code == 404:
        return False
    if resp.ok:
        return True
    logger.warning(f'Unexpected Daily room status for {room_name}: {resp.status_code}')
    return None
 
# ── Call API views ────────────────────────────────────────────────
 
@login_required
def active_call(request, workspace_id):
    """
    GET /api/workspace/<workspace_id>/call/active/
    Returns the currently active call for this workspace, or {active: false}.
    Used by clients on page-load to show the persistent call banner if a call
    is already in progress when they arrive.
    """
    if not WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).exists():
        return JsonResponse({'error': 'not a member'}, status=403)
 
    call = WorkspaceCall.objects.filter(
        workspace_id=workspace_id, is_active=True
    ).select_related('initiated_by').first()
 
    if not call:
        return JsonResponse({'active': False})
 
    room_status = _check_daily_room_exists(call.room_name)
    if room_status is False:
        call.is_active = False
        call.ended_at = timezone.now()
        call.save(update_fields=['is_active', 'ended_at'])
        return JsonResponse({'active': False})
 
    display_name = (
        getattr(call.initiated_by, 'display_name', None)
        or (call.initiated_by.username if call.initiated_by else 'Someone')
    )
 
    return JsonResponse({
        'active':      True,
        'call_id':     call.id,
        'call_type':   call.call_type,
        'caller_id':   call.initiated_by_id,
        'caller_name': display_name,
        'room_url':    call.room_url,
    })
   
@login_required
def start_call(request, workspace_id):
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST required'}, status=405)
 
    membership = WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).first()
    if not membership:
        return JsonResponse({'success': False, 'error': 'Not a member'}, status=403)
 
    try:
        body = json.loads(request.body or '{}')
    except (json.JSONDecodeError, ValueError):
        body = {}
 
    call_type = body.get('call_type', 'video')
    if call_type not in ('voice', 'video'):
        call_type = 'video'
 
    # Deactivate existing active calls for this workspace
    WorkspaceCall.objects.filter(
        workspace_id=workspace_id, is_active=True
    ).update(is_active=False, ended_at=timezone.now())
 
    # Create Daily.co room
    try:
        room_name, room_url = _create_daily_room(workspace_id, call_type)
    except Exception as exc:
        logger.error(f'start_call room creation failed: {exc}')
        return JsonResponse({'success': False, 'error': str(exc)}, status=500)
 
    # Save to DB
    call = WorkspaceCall.objects.create(
        workspace_id=workspace_id,
        initiated_by=request.user,
        room_name=room_name,
        room_url=room_url,
        call_type=call_type,
        is_active=True,
    )
 
    # Create caller token (owner)
    display_name = getattr(request.user, 'display_name', None) or request.user.username
    try:
        token = _create_daily_token(room_name, display_name, is_owner=True)
    except Exception as exc:
        logger.error(f'start_call token creation failed: {exc}')
        call.delete()
        _delete_daily_room(room_name)
        return JsonResponse({'success': False, 'error': str(exc)}, status=500)
 
    # Broadcast incoming-call signal to workspace via WebSocket
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'workspace_{workspace_id}',
            {
                'type':         'call_signal',
                'signal':       'incoming_call',
                'call_id':      call.id,
                'call_type':    call_type,
                'caller_id':    request.user.id,
                'caller_name':  display_name,
                'workspace_id': workspace_id,
            }
        )
    except Exception as exc:
        logger.warning(f'start_call WS broadcast failed (non-fatal): {exc}')
 
    return JsonResponse({
        'success':   True,
        'call_id':   call.id,
        'room_url':  room_url,
        'room_name': room_name,
        'token':     token,
        'call_type': call_type,
    })
 
 
@login_required
def join_call(request, workspace_id, call_id):
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST required'}, status=405)
 
    membership = WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).first()
    if not membership:
        return JsonResponse({'success': False, 'error': 'Not a member'}, status=403)
 
    call = WorkspaceCall.objects.filter(
        id=call_id, workspace_id=workspace_id, is_active=True
    ).first()
    if not call:
        return JsonResponse(
            {'success': False, 'error': 'Call not found or already ended'}, status=404
        )
 
    display_name = getattr(request.user, 'display_name', None) or request.user.username
    try:
        token = _create_daily_token(call.room_name, display_name, is_owner=False)
    except Exception as exc:
        logger.error(f'join_call token creation failed: {exc}')
        return JsonResponse({'success': False, 'error': str(exc)}, status=500)
 
    return JsonResponse({
        'success':   True,
        'call_id':   call.id,
        'room_url':  call.room_url,
        'room_name': call.room_name,
        'token':     token,
        'call_type': call.call_type,
    })
 
 
@login_required
def end_call(request, workspace_id, call_id):
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST required'}, status=405)
 
    membership = WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).first()
    if not membership:
        return JsonResponse({'success': False, 'error': 'Not a member'}, status=403)
 
    call = WorkspaceCall.objects.filter(
        id=call_id, workspace_id=workspace_id, is_active=True
    ).first()
    if not call:
        return JsonResponse({'success': False, 'error': 'Call not found'}, status=404)
 
    call.is_active = False
    call.ended_at  = timezone.now()
    call.save(update_fields=['is_active', 'ended_at'])
 
    _delete_daily_room(call.room_name)
 
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'workspace_{workspace_id}',
            {
                'type':         'call_signal',
                'signal':       'call_ended',
                'call_id':      call_id,
                'caller_id':    None,
                'workspace_id': workspace_id,
            }
        )
    except Exception as exc:
        logger.warning(f'end_call WS broadcast failed (non-fatal): {exc}')
 
    return JsonResponse({'success': True})
 
 
@login_required
def decline_call(request, workspace_id, call_id):
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST required'}, status=405)
    return JsonResponse({'success': True})

# -----------------------Chat page Settings Logic---------------------------------


#  ----------------------- Danger Zone Tab Logic ------------------------------------------
# Delete workspace (admin only)
@login_required
def delete_workspace(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)

    # Only workspace admin can delete
    if workspace.admin != request.user:
        messages.error(request, "Only the workspace admin can delete this workspace.")
        return redirect("chatui", workspace_id=workspace.id)

    if request.method == "POST":
        confirm_title = request.POST.get("title")
        if confirm_title != workspace.title:
            messages.error(request, "Workspace title does not match. Cannot delete.")
            return redirect("chatui", workspace_id=workspace.id)

        workspace.delete()
        messages.success(request, f"Workspace '{confirm_title}' deleted successfully!")
        return redirect("profile")  # back to profile after deletion

    return redirect("chatui", workspace_id=workspace.id)


@login_required
def delete_workspace_api(request, workspace_id):
    """Delete workspace (AJAX version)"""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    try:
        workspace = get_object_or_404(Workspace, id=workspace_id)
        
        # Only workspace admin can delete
        if workspace.admin != request.user:
            return JsonResponse({"error": "Only the workspace admin can delete this workspace."}, status=403)
        
        data = json.loads(request.body)
        confirm_title = data.get("title", "").strip()
        
        if confirm_title != workspace.title:
            return JsonResponse({"error": "Workspace title does not match. Cannot delete."}, status=400)
        
        workspace_name = workspace.title
        workspace.delete()
        return JsonResponse({"success": True, "message": f"Workspace '{workspace_name}' deleted successfully!"})
    
    except Exception as e:
        print(f"Error in delete_workspace_api: {str(e)}")
        import traceback
        traceback.print_exc()
        return JsonResponse({"error": f"Server error: {str(e)}"}, status=500)



@login_required
def transfer_ownership(request, workspace_id):
    """Transfer admin ownership to another member"""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    try:
        workspace = get_object_or_404(Workspace, id=workspace_id)
        
        # Check if current user is the admin
        if workspace.admin != request.user:
            return JsonResponse({"error": "Only workspace admin can transfer ownership"}, status=403)
        
        data = json.loads(request.body)
        target_username = data.get("target_username", "").strip()
        
        if not target_username:
            return JsonResponse({"error": "Target username required"}, status=400)
        
        # Get target user
        target_user = CustomUser.objects.filter(username=target_username).first()
        if not target_user:
            return JsonResponse({"error": "User not found"}, status=404)
        
        # Check if target user is member of workspace
        target_membership = WorkspaceMembership.objects.filter(
            workspace=workspace, user=target_user
        ).first()
        
        if not target_membership:
            return JsonResponse({"error": "User is not a member of this workspace"}, status=400)
        
        # Transfer ownership
        workspace.admin = target_user
        workspace.save()
        
        # Update current user's role to member
        current_membership = WorkspaceMembership.objects.filter(
            workspace=workspace, user=request.user
        ).first()
        if current_membership:
            current_membership.role = "member"
            current_membership.save()
        
        # Update target user's role to admin
        target_membership.role = "admin"
        target_membership.save()
        
        return JsonResponse({"success": True, "message": f"Ownership transferred to {target_user.display_name or target_user.username}"})
    
    except Exception as e:
        print(f"Error in transfer_ownership: {str(e)}")
        import traceback
        traceback.print_exc()
        return JsonResponse({"error": f"Server error: {str(e)}"}, status=500)


@login_required
def leave_workspace(request, workspace_id):
    """Leave workspace - members can leave anytime, admins need to transfer first"""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    try:
        workspace = get_object_or_404(Workspace, id=workspace_id)
        
        membership = WorkspaceMembership.objects.filter(
            user=request.user, workspace_id=workspace_id
        ).first()
        
        if not membership:
            return JsonResponse({"error": "Not a member of this workspace"}, status=403)
        
        # If user is admin, check if there's another admin
        if membership.role == "admin":
            other_admins = WorkspaceMembership.objects.filter(
                workspace=workspace,
                role="admin"
            ).exclude(user=request.user)
            
            if not other_admins.exists():
                return JsonResponse(
                    {"error": "You are the only admin. Please transfer ownership before leaving."},
                    status=400
                )
        
        # Remove user from workspace
        membership.delete()
        return JsonResponse({"success": True, "message": "You have left the workspace"})
    
    except Exception as e:
        print(f"Error in leave_workspace: {str(e)}")
        import traceback
        traceback.print_exc()
        return JsonResponse({"error": f"Server error: {str(e)}"}, status=500)

#  ------------------------ Users Tab-----------------------------------------------
@login_required
def members_api(request, workspace_id):
    """Get all members of a workspace with their roles"""
    membership = WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).first()

    if not membership:
        return JsonResponse({'error': 'not a member'}, status=403)

    workspace = membership.workspace
    members_list = WorkspaceMembership.objects.filter(
        workspace=workspace
    ).select_related("user")

    is_admin = membership.role == "admin"

    data = {
        "is_admin": is_admin,
        "members": [
            {
                "id": m.user.id,
                "username": m.user.username,
                "display_name": m.user.display_name or m.user.username,
                "role": m.role,
                "status": m.user.status,
                "avatar": m.user.profile_picture_url if m.user.profile_picture else None,
            }
            for m in members_list
        ]
    }
    return JsonResponse(data)


#  Remove a user from workspace (admin only)
@login_required
def remove_member(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)

    # Only admins can remove members
    membership = WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).first()

    if not membership or membership.role != "admin":
        error_msg = "Only admins can remove members."
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return JsonResponse({'error': error_msg, 'is_admin': False}, status=403)
        messages.error(request, error_msg)
        return redirect("chatui", workspace_id=workspace.id)

    if request.method == "POST":
        username = request.POST.get("username", "").strip()

        if not username:
            error_msg = "Username is required."
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({'error': error_msg}, status=400)
            messages.error(request, error_msg)
            return redirect("chatui", workspace_id=workspace.id)

        try:
            user_to_remove = CustomUser.objects.get(username=username)
        except CustomUser.DoesNotExist:
            error_msg = "User not found."
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({'error': error_msg}, status=404)
            messages.error(request, error_msg)
            return redirect("chatui", workspace_id=workspace.id)

        # Prevent removing admin (yourself or other admins)
        target_membership = WorkspaceMembership.objects.filter(
            workspace=workspace, user=user_to_remove
        ).first()

        if not target_membership:
            error_msg = f"{username} is not in this workspace."
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({'error': error_msg}, status=404)
            messages.error(request, error_msg)
            return redirect("chatui", workspace_id=workspace.id)

        if target_membership.role == "admin":
            error_msg = "Admins cannot be removed from workspace."
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({'error': error_msg}, status=400)
            messages.error(request, error_msg)
            return redirect("chatui", workspace_id=workspace.id)

        # Successfully remove the member
        target_membership.delete()
        
        # Clean up all invitation records for this user in this workspace
        # This allows them to be re-added later without conflicts
        Invitation.objects.filter(
            workspace=workspace,
            recipient_user=user_to_remove
        ).delete()
        
        success_msg = f"{username} has been removed from {workspace.title}."
        
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return JsonResponse({'success': True, 'message': success_msg})
        
        messages.success(request, success_msg)
        return redirect("chatui", workspace_id=workspace.id)

    return redirect("chatui", workspace_id=workspace.id)


#  ----------------------------- Settings Privacy Tab ----------------------------
@login_required
def get_privacy_settings(request, workspace_id):
    """Get privacy settings for a workspace"""
    workspace = get_object_or_404(Workspace, id=workspace_id)
    
    membership = WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).first()
    
    if not membership:
        return JsonResponse({"error": "Not a member"}, status=403)
    
    data = {
        "visibility": workspace.visibility,
        "invites_restricted_to_admins": workspace.invites_restricted_to_admins,
        "message_retention_days": workspace.message_retention_days,
        "is_admin": membership.role == "admin"
    }
    return JsonResponse(data)


@login_required
def update_privacy_settings(request, workspace_id):
    """Update privacy settings for a workspace (admin only)"""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    
    try:
        workspace = get_object_or_404(Workspace, id=workspace_id)
        
        membership = WorkspaceMembership.objects.filter(
            user=request.user, workspace_id=workspace_id
        ).first()
        
        if not membership:
            return JsonResponse({"error": "Not a member"}, status=403)
        
        if membership.role != "admin":
            return JsonResponse({"error": "Only admins can update privacy settings"}, status=403)
        
        data = json.loads(request.body)
        
        # Update visibility
        if "visibility" in data:
            if data["visibility"] not in ["public", "private"]:
                return JsonResponse({"error": "Invalid visibility option"}, status=400)
            workspace.visibility = data["visibility"]
        
        # Update invite restriction
        if "invites_restricted_to_admins" in data:
            workspace.invites_restricted_to_admins = data["invites_restricted_to_admins"]
        
        # Update message retention
        if "message_retention_days" in data:
            retention = data["message_retention_days"]
            if retention is not None:
                retention = int(retention)
                if retention not in [7, 30, 90, None]:
                    return JsonResponse({"error": "Invalid retention period"}, status=400)
            workspace.message_retention_days = retention
        
        workspace.save()
        
        return JsonResponse({
            "success": True,
            "message": "Privacy settings updated successfully",
            "settings": {
                "visibility": workspace.visibility,
                "invites_restricted_to_admins": workspace.invites_restricted_to_admins,
                "message_retention_days": workspace.message_retention_days
            }
        })
    
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    except Exception as e:
        print(f"Error updating privacy settings: {str(e)}")
        import traceback
        traceback.print_exc()
        return JsonResponse({"error": f"Server error: {str(e)}"}, status=500)


@login_required
def cleanup_old_messages(request, workspace_id):
    """Delete messages older than retention period (called periodically or on demand)"""
    try:
        workspace = get_object_or_404(Workspace, id=workspace_id)
        
        membership = WorkspaceMembership.objects.filter(
            user=request.user, workspace_id=workspace_id
        ).first()
        
        if not membership:
            return JsonResponse({"error": "Not a member"}, status=403)
        
        if membership.role != "admin":
            return JsonResponse({"error": "Only admins can trigger cleanup"}, status=403)
        
        if not workspace.message_retention_days:
            return JsonResponse({"error": "No retention policy set"}, status=400)
        
        from datetime import timedelta
        from django.utils import timezone
        
        cutoff_date = timezone.now() - timedelta(days=workspace.message_retention_days)
        deleted_count, _ = Message.objects.filter(
            workspace=workspace,
            created_at__lt=cutoff_date
        ).delete()
        
        return JsonResponse({
            "success": True,
            "message": f"Deleted {deleted_count} old messages",
            "deleted_count": deleted_count
        })
    
    except Exception as e:
        print(f"Error cleaning up messages: {str(e)}")
        import traceback
        traceback.print_exc()
        return JsonResponse({"error": f"Server error: {str(e)}"}, status=500)


#  --------------------------- Settings Invitation Tab---------------------
@login_required
def add_member_manual(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)

    # Only admins can add members
    if not is_workspace_admin(request.user, workspace):
        messages.error(request, "Only admins can add members.")
        return redirect("chatui", workspace_id=workspace.id)

    if request.method == "POST":
        identifier = request.POST.get("identifier")  # username or email
        role = request.POST.get("role", "member")   # default to member

        try:
            user = CustomUser.objects.get(
                models.Q(username=identifier) | models.Q(email=identifier)
            )
        except CustomUser.DoesNotExist:
            messages.error(request, "User not found. Ask them to signup first.")
            return redirect("chatui", workspace_id=workspace.id)

        #  Check if user is already part of 50 or more workspaces
        existing_memberships = WorkspaceMembership.objects.filter(user=user).count()
        if existing_memberships >= 50:
            messages.error(request, f"{user.username} is already part of 50 workspaces and cannot be added.")
            return redirect("chatui", workspace_id=workspace.id)

        # Add the user if they are eligible
        WorkspaceMembership.objects.get_or_create(
            workspace=workspace, user=user, defaults={"role": role}
        )
        messages.success(request, f"{user.username} added to workspace as {role}!")
        return redirect("chatui", workspace_id=workspace.id)

    # Default redirect (in case of GET request or fallback)
    return redirect("chatui", workspace_id=workspace.id)


@login_required
def send_invitation(request, workspace_id):
    """Send invitation to user by email or username"""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    try:
        workspace = get_object_or_404(Workspace, id=workspace_id)
        
        # Check if user is member of workspace
        membership = WorkspaceMembership.objects.filter(
            user=request.user, workspace_id=workspace_id
        ).first()
        
        if not membership:
            return JsonResponse({"error": "Not a member"}, status=403)
        
        # Permission check: check invites_restricted_to_admins setting
        if workspace.invites_restricted_to_admins and membership.role != "admin":
            return JsonResponse({"error": "Only admins can send invites in this workspace"}, status=403)
        
        # Permission check: only admins for private workspaces
        if workspace.visibility == "private" and membership.role != "admin":
            return JsonResponse({"error": "Only admins can send invites in private workspaces"}, status=403)
        
        # Parse request body
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
        
        identifier = data.get("identifier", "").strip()
        role = data.get("role", "member")
        
        if not identifier:
            return JsonResponse({"error": "Email or username required"}, status=400)
        
        if role not in ["member", "admin"]:
            return JsonResponse({"error": "Invalid role"}, status=400)
        
        # Determine if identifier is email or username
        is_email = "@" in identifier
        
        if is_email:
            # Email-based invitation
            user = CustomUser.objects.filter(email=identifier).first()
            
            if user:
                # User exists
                if WorkspaceMembership.objects.filter(workspace=workspace, user=user).exists():
                    return JsonResponse({"error": "User already in workspace"}, status=400)
                
                # Check if invitation already exists
                existing_invite = Invitation.objects.filter(
                    workspace=workspace,
                    recipient_user=user
                ).first()
                if existing_invite:
                    return JsonResponse({"error": "Invitation already sent to this user"}, status=400)
                
                # Add user to workspace and create accepted invitation
                WorkspaceMembership.objects.create(workspace=workspace, user=user, role=role)
                Invitation.objects.create(
                    workspace=workspace,
                    invited_by=request.user,
                    recipient_email=identifier,
                    recipient_user=user,
                    role=role,
                    status="accepted"
                )
                return JsonResponse({"success": True, "message": f"User added as {role}"})
            else:
                # User doesn't exist yet - send pending invitation
                existing_invite = Invitation.objects.filter(
                    workspace=workspace,
                    recipient_email=identifier
                ).first()
                if existing_invite:
                    return JsonResponse({"error": "Invitation already sent to this email"}, status=400)
                
                Invitation.objects.create(
                    workspace=workspace,
                    invited_by=request.user,
                    recipient_email=identifier,
                    role=role,
                    status="pending"
                )
                return JsonResponse({"success": True, "message": f"Invitation sent to {identifier}"})
        else:
            # Username-based invitation
            user = CustomUser.objects.filter(username=identifier).first()
            if not user:
                return JsonResponse({"error": "User not found"}, status=404)
            
            if WorkspaceMembership.objects.filter(workspace=workspace, user=user).exists():
                return JsonResponse({"error": "User already in workspace"}, status=400)
            
            # Check if invitation already exists
            existing_invite = Invitation.objects.filter(
                workspace=workspace,
                recipient_user=user
            ).first()
            if existing_invite:
                return JsonResponse({"error": "Invitation already sent to this user"}, status=400)
            
            # Add user to workspace and create accepted invitation
            WorkspaceMembership.objects.create(workspace=workspace, user=user, role=role)
            Invitation.objects.create(
                workspace=workspace,
                invited_by=request.user,
                recipient_user=user,
                role=role,
                status="accepted"
            )
            return JsonResponse({"success": True, "message": f"User added as {role}"})
    
    except Exception as e:
        print(f"Error in send_invitation: {str(e)}")
        import traceback
        traceback.print_exc()
        return JsonResponse({"error": f"Server error: {str(e)}"}, status=500)


@login_required
def get_sent_invitations(request, workspace_id):
    """Get all invitations sent to this workspace"""
    membership = WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).first()
    
    if not membership:
        return JsonResponse({"error": "Not a member"}, status=403)
    
    invitations = Invitation.objects.filter(workspace_id=workspace_id).select_related(
        "invited_by", "recipient_user"
    )
    
    data = {
        "invitations": [
            {
                "id": inv.id,
                "recipient": inv.recipient_user.display_name or inv.recipient_user.username if inv.recipient_user else inv.recipient_email,
                "recipient_email": inv.recipient_email,
                "recipient_username": inv.recipient_user.username if inv.recipient_user else None,
                "role": inv.role,
                "status": inv.status,
                "invited_by": inv.invited_by.display_name or inv.invited_by.username if inv.invited_by else "Unknown",
                "created_at": inv.created_at.strftime("%Y-%m-%d %H:%M"),
            }
            for inv in invitations
        ]
    }
    return JsonResponse(data)


# __________________________Invite Links____________________________________

@login_required
def get_invite_links(request, workspace_id):
    # Permission check: only admins can view invite links
    membership = WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).first()
    
    if not membership or membership.role != "admin":
        return JsonResponse({"error": "Only admins can view invite links"}, status=403)

    invites = WorkspaceInvite.objects.filter(
        workspace_id=workspace_id,
        is_active=True
    ).order_by('-created_at')

    data = []
    now = timezone.now()

    for inv in invites:
        # Check if expired
        is_expired = inv.expires_at and inv.expires_at < now
        
        expires_text = "No expiry"
        if inv.expires_at:
            expires_text = inv.expires_at.strftime("%Y-%m-%d %H:%M")
        
        data.append({
            "id": inv.id,
            "code": f"/invite/{inv.token}",
            "expires": expires_text,
            "is_expired": is_expired,
            "usage": f"{inv.uses}/{inv.max_uses}",
            "created_by": inv.created_by.display_name or inv.created_by.username
        })

    return JsonResponse({"links": data, "total_active": len(invites)})

from django.views.decorators.http import require_POST

@login_required
@require_POST
def create_invite_link(request, workspace_id):
    try:
        workspace = get_object_or_404(Workspace, id=workspace_id)
        membership = WorkspaceMembership.objects.filter(
            user=request.user, workspace_id=workspace_id
        ).first()
        
        # Permission check based on workspace privacy and settings
        # Private workspaces: only admins can create invites
        # Public workspaces: check invites_restricted_to_admins setting
        if workspace.visibility == "private":
            if not membership or membership.role != "admin":
                return JsonResponse({"error": "Only admins can create invite links in private workspaces"}, status=403)
        elif workspace.invites_restricted_to_admins:
            if not membership or membership.role != "admin":
                return JsonResponse({"error": "Only admins can create invite links in this workspace"}, status=403)
        else:
            # Public workspace with invite creation allowed for all members
            if not membership:
                return JsonResponse({"error": "You must be a member to create invite links"}, status=403)
        
        # Check 5 active links limit
        active_links = WorkspaceInvite.objects.filter(
            workspace_id=workspace_id,
            is_active=True
        ).count()
        
        if active_links >= 5:
            return JsonResponse({"error": "Maximum 5 active invite links allowed per workspace"}, status=400)
        
        # Parse request data for expiry
        data = json.loads(request.body) if request.body else {}
        expires_in_days = data.get("expires_in_days", None)
        
        expires_at = None
        if expires_in_days:
            try:
                expires_in_days = int(expires_in_days)
                if expires_in_days > 0:
                    expires_at = timezone.now() + timedelta(days=expires_in_days)
            except (ValueError, TypeError):
                return JsonResponse({"error": "Invalid expiry days value"}, status=400)
        
        invite = WorkspaceInvite.objects.create(
            workspace_id=workspace_id,
            created_by=request.user,
            expires_at=expires_at
        )
        
        expires_text = "No expiry"
        if invite.expires_at:
            expires_text = invite.expires_at.strftime("%Y-%m-%d %H:%M")

        return JsonResponse({
            "success": True,
            "link": {
                "id": invite.id,
                "code": f"/invite/{invite.token}",
                "expires": expires_text,
                "usage": f"{invite.uses}/{invite.max_uses}",
                "created_by": request.user.display_name or request.user.username
            }
        })
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid request data"}, status=400)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

@login_required
@require_POST
def revoke_invite(request, invite_id):
    try:
        invite = get_object_or_404(WorkspaceInvite, id=invite_id)
        
        # Permission check: only admins of the workspace can revoke
        membership = WorkspaceMembership.objects.filter(
            user=request.user, workspace_id=invite.workspace_id
        ).first()
        
        if not membership or membership.role != "admin":
            return JsonResponse({"error": "Only admins can revoke invite links"}, status=403)
        
        invite.is_active = False
        invite.save()
        
        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


def join_workspace_invite(request, token):
    try:
        invite = get_object_or_404(WorkspaceInvite, token=token, is_active=True)
        workspace = invite.workspace
        now = timezone.now()
        
        # Check if invite has expired
        if invite.expires_at and invite.expires_at < now:
            return JsonResponse({"error": "This invite link has expired"}, status=400)
        
        # Check if invite has exceeded max uses
        if invite.uses >= invite.max_uses:
            return JsonResponse({"error": "This invite link has reached its maximum number of uses"}, status=400)
        
        if not request.user.is_authenticated:
            return redirect(f"/login/?next=/invite/{token}/")
        
        # Check if user is already a member
        existing_membership = WorkspaceMembership.objects.filter(
            workspace=workspace, user=request.user
        ).first()
        
        if not existing_membership:
            # Add user to workspace as a member
            WorkspaceMembership.objects.create(
                workspace=workspace,
                user=request.user,
                role="member"
            )
        
        # Increment uses
        invite.uses += 1
        invite.save()
        
        return redirect(f"/chatui/{workspace.id}/")
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

# ------------------------------ TaskBoard logic---------------------------


# ─── constants ────────────────────────────────────────────────────────────────
 
DEFAULT_LISTS = [
    {"name": "To Do",       "color": "#60a5fa", "position": 0},
    {"name": "In Progress", "color": "#facc15", "position": 1},
    {"name": "In Review",   "color": "#a78bfa", "position": 2},
    {"name": "Done",        "color": "#4ade80", "position": 3},
]
 
VALID_PERM_FIELDS = {
    "who_can_create_tasks", "who_can_edit_tasks", "who_can_delete_tasks",
    "who_can_move_tasks", "who_can_create_lists", "who_can_edit_lists",
    "who_can_delete_lists", "who_can_attach_files", "who_can_comment",
}
VALID_BOOL_FIELDS = {
    "allow_due_dates", "allow_task_priorities", "allow_task_assignees",
    "allow_attachments", "allow_comments", "allow_task_desc",
    "notify_on_task_create", "notify_on_task_done",
    "notify_on_comment", "notify_on_assign",
}
VALID_INT_FIELDS = {"max_tasks_per_list", "max_lists"}
VALID_PERM_VALUES = {"all_members", "admin_only"}
 
 
# ─── shared helpers ───────────────────────────────────────────────────────────
 
def _get_membership(workspace, user):
    try:
        return WorkspaceMembership.objects.get(workspace=workspace, user=user)
    except WorkspaceMembership.DoesNotExist:
        return None
 
def _is_member(workspace, user):
    return WorkspaceMembership.objects.filter(workspace=workspace, user=user).exists()
 
def _is_admin(workspace, user):
    return WorkspaceMembership.objects.filter(
        workspace=workspace, user=user, role="admin"
    ).exists()
 
def _get_or_create_settings(workspace):
    ts, _ = TaskboardSettings.objects.get_or_create(workspace=workspace)
    return ts
 
def _ensure_default_lists(workspace):
    if not TaskList.objects.filter(workspace=workspace).exists():
        for d in DEFAULT_LISTS:
            TaskList.objects.create(workspace=workspace, **d, is_default=True)
 
def _check_perm(ts, field, workspace, user):
    """
    Return True if the user is allowed to do the action described by `field`.
    Admins always pass. Non-admins pass only if the field is 'all_members'.
    """
    if _is_admin(workspace, user):
        return True
    value = getattr(ts, field, "all_members")
    return value == "all_members"
 
def _over_list_limit(workspace, ts):
    if ts.max_lists == 0:
        return False
    return TaskList.objects.filter(workspace=workspace).count() >= ts.max_lists
 
def _over_task_limit(task_list, ts):
    if ts.max_tasks_per_list == 0:
        return False
    return Task.objects.filter(task_list=task_list).count() >= ts.max_tasks_per_list
 
def _broadcast_taskboard_event(workspace_id, payload):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    payload = payload.copy()
    payload.setdefault('type', 'taskboard_event')
    async_to_sync(channel_layer.group_send)(f"taskboard_{workspace_id}", payload)
 
def _broadcast_workspace_event(workspace_id, payload):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    payload = payload.copy()
    payload.setdefault('type', 'notification_event')
    async_to_sync(channel_layer.group_send)(f"workspace_{workspace_id}", payload)
 
def _create_notification_records(workspace, user_ids, actor, section, notification_type, message, reference_id=None):
    notifications = []
    for user_id in user_ids:
        notifications.append(Notification(
            workspace=workspace,
            user_id=user_id,
            actor=actor,
            section=section,
            notification_type=notification_type,
            message=message,
            reference_id=str(reference_id) if reference_id is not None else None,
        ))
    Notification.objects.bulk_create(notifications)
 
def _notify_workspace_users(workspace, actor, section, notification_type, message, reference_id=None, target_user_id=None, extra_user_ids=None):
    membership_qs = WorkspaceMembership.objects.filter(workspace=workspace)
    if extra_user_ids is not None:
        membership_qs = membership_qs.filter(user_id__in=extra_user_ids)
    if actor is not None:
        membership_qs = membership_qs.exclude(user=actor)
    user_ids = list(membership_qs.values_list('user_id', flat=True))
    if user_ids:
        _create_notification_records(workspace, user_ids, actor, section, notification_type, message, reference_id)
    payload = {
        "notification": True,
        "notification_section": section,
        "notification_type": notification_type,
        "notification_message": message,
        "notification_actor_id": actor.id if actor else None,
    }
    if target_user_id is not None:
        payload["notification_target_user_id"] = target_user_id
    if reference_id is not None:
        payload["notification_reference_id"] = str(reference_id)
    _broadcast_workspace_event(workspace.id, payload)
 
def _get_notification_counts(workspace, user):
    unread_qs = Notification.objects.filter(workspace=workspace, user=user, is_read=False)
    chat_count = unread_qs.filter(section='chat').count()
    taskboard_count = unread_qs.filter(section='taskboard').count()
    dm_items = unread_qs.filter(section='dm').values('actor_id').annotate(count=Count('id'))
    dm_counts = {str(item['actor_id']): item['count'] for item in dm_items if item['actor_id']}
    return {
        'chat': chat_count,
        'taskboard': taskboard_count,
        'dm_counts': dm_counts,
        'dm_total': sum(dm_counts.values()),
    }
 
@login_required
@require_GET
def notification_counts_api(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    return JsonResponse(_get_notification_counts(workspace, request.user))
 
@login_required
@require_POST
def notification_mark_read(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    section = body.get('section')
    if section == 'chat':
        Notification.objects.filter(workspace=workspace, user=request.user, section='chat', is_read=False).update(is_read=True)
    elif section == 'taskboard':
        Notification.objects.filter(workspace=workspace, user=request.user, section='taskboard', is_read=False).update(is_read=True)
    elif section == 'dm':
        other_id = body.get('other_user_id')
        if not other_id:
            return JsonResponse({"error": "other_user_id is required for DM read receipts."}, status=400)
        Notification.objects.filter(
            workspace=workspace,
            user=request.user,
            section='dm',
            actor_id=other_id,
            is_read=False
        ).update(is_read=True)
    elif section == 'all':
        Notification.objects.filter(workspace=workspace, user=request.user, is_read=False).update(is_read=True)
    else:
        return JsonResponse({"error": "Invalid section"}, status=400)
    return JsonResponse(_get_notification_counts(workspace, request.user))
 

def _serialize_settings(ts):
    return {
        "who_can_create_tasks":  ts.who_can_create_tasks,
        "who_can_edit_tasks":    ts.who_can_edit_tasks,
        "who_can_delete_tasks":  ts.who_can_delete_tasks,
        "who_can_move_tasks":    ts.who_can_move_tasks,
        "who_can_create_lists":  ts.who_can_create_lists,
        "who_can_edit_lists":    ts.who_can_edit_lists,
        "who_can_delete_lists":  ts.who_can_delete_lists,
        "who_can_attach_files":  ts.who_can_attach_files,
        "who_can_comment":       ts.who_can_comment,
        "allow_due_dates":       ts.allow_due_dates,
        "allow_task_priorities": ts.allow_task_priorities,
        "allow_task_assignees":  ts.allow_task_assignees,
        "allow_attachments":     ts.allow_attachments,
        "allow_comments":        ts.allow_comments,
        "allow_task_desc":       ts.allow_task_desc,
        "notify_on_task_create": ts.notify_on_task_create,
        "notify_on_task_done":   ts.notify_on_task_done,
        "notify_on_comment":     ts.notify_on_comment,
        "notify_on_assign":      ts.notify_on_assign,
        "max_tasks_per_list":    ts.max_tasks_per_list,
        "max_lists":             ts.max_lists,
        "updated_at":            ts.updated_at.isoformat() if ts.updated_at else None,
        "updated_by":            ts.updated_by.display_name or ts.updated_by.username if ts.updated_by else None,
    }
 
def _serialize_list(tl):
    return {
        "id":         tl.id,
        "name":       tl.name,
        "color":      tl.color,
        "position":   tl.position,
        "is_default": tl.is_default,
    }
 
def _serialize_task(task):
    att_list, cmt_list = [], []
    for a in task.attachments.select_related("uploaded_by").all():
        att_list.append({
            "id":            a.id,
            "type":          a.attachment_type,
            "original_name": a.original_name,
            "file_size":     a.file_size,
            "link_url":      a.link_url,
            "url":           a.url,
            "uploaded_by":   (a.uploaded_by.display_name or a.uploaded_by.username) if a.uploaded_by else None,
            "created_at":    a.created_at.isoformat(),
        })
    for c in task.comments.select_related("author").all():
        cmt_list.append({
            "id":           c.id,
            "author":       c.author.display_name or c.author.username,
            "author_avatar": c.author.profile_picture_url if c.author.profile_picture else None,
            "text":         c.text,
            "created_at":   c.created_at.isoformat(),
        })
    return {
        "id":               task.id,
        "title":            task.title,
        "description":      task.description,
        "task_list_id":     task.task_list_id,
        "priority":         task.priority,
        "complete":         task.complete,
        "assignee_id":      task.assignee_id,
        "assignee_display": (task.assignee.display_name or task.assignee.username) if task.assignee else None,
        "created_at":       task.created_at.isoformat(),
        "attachments":      att_list,
        "comments":         cmt_list,
    }
 
 
# ─── page ─────────────────────────────────────────────────────────────────────
 
@login_required
def taskboard(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
 
    if not _is_member(workspace, request.user):
        django_messages.error(request, "You are not part of this workspace.")
        return redirect("profile")
 
    _ensure_default_lists(workspace)
    ts = _get_or_create_settings(workspace)
 
    members    = WorkspaceMembership.objects.filter(workspace=workspace).select_related("user")
    dm_members = members.exclude(user=request.user)
    is_admin   = _is_admin(workspace, request.user)
 
    # Effective permissions for this user (passed to template → JS)
    perms = {
        "can_create_tasks":  _check_perm(ts, "who_can_create_tasks",  workspace, request.user),
        "can_edit_tasks":    _check_perm(ts, "who_can_edit_tasks",    workspace, request.user),
        "can_delete_tasks":  _check_perm(ts, "who_can_delete_tasks",  workspace, request.user),
        "can_move_tasks":    _check_perm(ts, "who_can_move_tasks",    workspace, request.user),
        "can_create_lists":  _check_perm(ts, "who_can_create_lists",  workspace, request.user),
        "can_edit_lists":    _check_perm(ts, "who_can_edit_lists",    workspace, request.user),
        "can_delete_lists":  _check_perm(ts, "who_can_delete_lists",  workspace, request.user),
        "can_attach_files":  _check_perm(ts, "who_can_attach_files",  workspace, request.user),
        "can_comment":       _check_perm(ts, "who_can_comment",       workspace, request.user),
    }
 
    notification_counts = _get_notification_counts(workspace, request.user)
    return render(request, "taskboard.html", {
        "workspace":  workspace,
        "members":    members,
        "dm_members": dm_members,
        "is_admin":   is_admin,
        "perms":      perms,
        "ts":         ts,
        "notification_counts": notification_counts,
        "notification_counts_json": json.dumps(notification_counts),
    })
 
 
# ─── taskboard settings API ───────────────────────────────────────────────────
 
@login_required
@require_GET
def taskboard_settings_get(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    ts = _get_or_create_settings(workspace)
    return JsonResponse({
        "settings":   _serialize_settings(ts),
        "is_admin":   _is_admin(workspace, request.user),
    })
 
 
@login_required
@require_POST
def taskboard_settings_update(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not _is_admin(workspace, request.user):
        return JsonResponse({"error": "Only admins can change board settings."}, status=403)
 
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
 
    ts = _get_or_create_settings(workspace)
    errors = []
 
    for field, value in body.items():
        if field in VALID_PERM_FIELDS:
            if value not in VALID_PERM_VALUES:
                errors.append(f"Invalid value '{value}' for {field}")
                continue
            setattr(ts, field, value)
        elif field in VALID_BOOL_FIELDS:
            setattr(ts, field, bool(value))
        elif field in VALID_INT_FIELDS:
            try:
                v = int(value)
                if v < 0:
                    raise ValueError
                setattr(ts, field, v)
            except (ValueError, TypeError):
                errors.append(f"Invalid value for {field}: must be non-negative integer")
        else:
            # silently ignore unknown fields (safe)
            pass
 
    if errors:
        return JsonResponse({"error": "; ".join(errors)}, status=400)
 
    ts.updated_by = request.user
    ts.save()

    settings_payload = _serialize_settings(ts)
    _broadcast_workspace_event(workspace.id, {
        "notification": True,
        "notification_section": "taskboard",
        "notification_type": "settings_update",
        "notification_message": f"{request.user.display_name or request.user.username} updated board settings",
        "notification_actor_id": request.user.id,
        "event_type": "settings_update",
        "object": "settings",
        "action": "update",
        "settings": settings_payload,
    })
    _create_notification_records(
        workspace,
        list(WorkspaceMembership.objects.filter(workspace=workspace).exclude(user=request.user).values_list('user_id', flat=True)),
        request.user,
        'taskboard',
        'settings_update',
        f"{request.user.display_name or request.user.username} updated board settings",
        reference_id=workspace.id,
    )

    return JsonResponse({"success": True, "settings": settings_payload})
 
 
# ─── task lists ───────────────────────────────────────────────────────────────
 
@login_required
@require_GET
def tasklists_api(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    _ensure_default_lists(workspace)
    lists = TaskList.objects.filter(workspace=workspace)
    ts    = _get_or_create_settings(workspace)
    return JsonResponse({
        "lists":    [_serialize_list(l) for l in lists],
        "settings": _serialize_settings(ts),
    })
 
 
@login_required
@require_POST
def tasklist_create(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    ts = _get_or_create_settings(workspace)
    if not _check_perm(ts, "who_can_create_lists", workspace, request.user):
        return JsonResponse({"error": "You don't have permission to create lists."}, status=403)
    if _over_list_limit(workspace, ts):
        return JsonResponse({"error": f"Board limit reached ({ts.max_lists} lists max)."}, status=400)
 
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
 
    name  = body.get("name", "").strip()
    color = body.get("color", "#60a5fa").strip()
    if not name:
        return JsonResponse({"error": "Name is required"}, status=400)
 
    last = TaskList.objects.filter(workspace=workspace).order_by("-position").first()
    tl   = TaskList.objects.create(
        workspace=workspace, name=name, color=color,
        position=(last.position + 1 if last else 0), is_default=False,
    )
    _broadcast_taskboard_event(workspace.id, {
        "action": "create",
        "object": "list",
        "list": _serialize_list(tl),
    })
    _notify_workspace_users(
        workspace, request.user, 'taskboard', 'list_create',
        f"{request.user.display_name or request.user.username} created list {tl.name}",
        reference_id=tl.id,
    )
    return JsonResponse({"success": True, "list": _serialize_list(tl)}, status=201)
 
 
@login_required
def tasklist_update(request, workspace_id, list_id):
    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    workspace = get_object_or_404(Workspace, id=workspace_id)
    tl        = get_object_or_404(TaskList, id=list_id, workspace=workspace)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    ts = _get_or_create_settings(workspace)
    if not _check_perm(ts, "who_can_edit_lists", workspace, request.user):
        return JsonResponse({"error": "You don't have permission to edit lists."}, status=403)
 
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
 
    if "name" in body:
        n = body["name"].strip()
        if n: tl.name = n
    if "color" in body:
        tl.color = body["color"].strip()
    tl.save()
    _broadcast_taskboard_event(workspace.id, {
        "action": "update",
        "object": "list",
        "list": _serialize_list(tl),
    })
    _notify_workspace_users(
        workspace, request.user, 'taskboard', 'list_update',
        f"{request.user.display_name or request.user.username} updated list {tl.name}",
        reference_id=tl.id,
    )
    return JsonResponse({"success": True, "list": _serialize_list(tl)})
 
 
@login_required
@require_POST
def tasklist_delete(request, workspace_id, list_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    tl        = get_object_or_404(TaskList, id=list_id, workspace=workspace)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    ts = _get_or_create_settings(workspace)
    if not _check_perm(ts, "who_can_delete_lists", workspace, request.user):
        return JsonResponse({"error": "You don't have permission to delete lists."}, status=403)
    if tl.is_default:
        return JsonResponse({"error": "Default lists cannot be deleted."}, status=400)
    tl.delete()
    _broadcast_taskboard_event(workspace.id, {
        "action": "delete",
        "object": "list",
        "list_id": list_id,
    })
    _notify_workspace_users(
        workspace, request.user, 'taskboard', 'list_delete',
        f"{request.user.display_name or request.user.username} deleted a list",
        reference_id=list_id,
    )
    return JsonResponse({"success": True})
 
 
# ─── tasks ────────────────────────────────────────────────────────────────────
 
@login_required
@require_GET
def tasks_api(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    tasks = (Task.objects
             .filter(workspace=workspace)
             .select_related("assignee")
             .prefetch_related("attachments__uploaded_by", "comments__author"))
    return JsonResponse({"tasks": [_serialize_task(t) for t in tasks]})
 
 
@login_required
@require_POST
def task_create(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    ts = _get_or_create_settings(workspace)
    if not _check_perm(ts, "who_can_create_tasks", workspace, request.user):
        return JsonResponse({"error": "You don't have permission to create tasks."}, status=403)
 
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
 
    title = body.get("title", "").strip()
    if not title:
        return JsonResponse({"error": "Title is required"}, status=400)
 
    list_id = body.get("task_list_id")
    tl      = get_object_or_404(TaskList, id=list_id, workspace=workspace) if list_id else None
 
    if tl and _over_task_limit(tl, ts):
        return JsonResponse(
            {"error": f"List '{tl.name}' has reached its task limit ({ts.max_tasks_per_list})."},
            status=400
        )
 
    assignee = None
    aid = body.get("assignee_id")
    if aid and ts.allow_task_assignees:
        try:
            m = WorkspaceMembership.objects.select_related("user").get(workspace=workspace, user_id=aid)
            assignee = m.user
        except WorkspaceMembership.DoesNotExist:
            return JsonResponse({"error": "Assignee is not a workspace member."}, status=400)
 
    priority = body.get("priority", "medium") if ts.allow_task_priorities else "medium"
    desc     = body.get("description", "").strip() if ts.allow_task_desc else ""
 
    task = Task.objects.create(
        workspace=workspace, task_list=tl, title=title,
        description=desc, priority=priority,
        assignee=assignee, created_by=request.user,
    )
    _broadcast_taskboard_event(workspace.id, {
        "action": "create",
        "object": "task",
        "task": _serialize_task(task),
    })
    _notify_workspace_users(
        workspace, request.user, 'taskboard', 'task_create',
        f"{request.user.display_name or request.user.username} created task {task.title}",
        reference_id=task.id,
    )
    return JsonResponse({"success": True, "task": _serialize_task(task)}, status=201)
 
 
@login_required
def task_update(request, workspace_id, task_id):
    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    workspace = get_object_or_404(Workspace, id=workspace_id)
    task      = get_object_or_404(Task, id=task_id, workspace=workspace)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    ts = _get_or_create_settings(workspace)
 
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
 
    can_edit = _check_perm(ts, "who_can_edit_tasks", workspace, request.user)
    can_move = _check_perm(ts, "who_can_move_tasks", workspace, request.user)
 
    # Complete toggle: anyone who can edit OR move can toggle
    if "complete" in body:
        if not (can_edit or can_move):
            return JsonResponse({"error": "Permission denied"}, status=403)
        task.complete = bool(body["complete"])
 
    # Move between lists
    if "task_list_id" in body:
        if not can_move:
            return JsonResponse({"error": "You don't have permission to move tasks."}, status=403)
        lid = body["task_list_id"]
        tl  = get_object_or_404(TaskList, id=lid, workspace=workspace) if lid else None
        task.task_list = tl
 
    # Edit fields
    if can_edit:
        if "title" in body:
            t = body["title"].strip()
            if t: task.title = t
        if "description" in body and ts.allow_task_desc:
            task.description = body["description"].strip()
        if "priority" in body and ts.allow_task_priorities:
            valid = [p[0] for p in Task.PRIORITY_CHOICES]
            if body["priority"] in valid:
                task.priority = body["priority"]
        if "assignee_id" in body and ts.allow_task_assignees:
            aid = body["assignee_id"]
            if aid is None:
                task.assignee = None
            else:
                try:
                    m = WorkspaceMembership.objects.select_related("user").get(
                        workspace=workspace, user_id=aid)
                    task.assignee = m.user
                except WorkspaceMembership.DoesNotExist:
                    return JsonResponse({"error": "Assignee not a member."}, status=400)
    elif any(k in body for k in ("title", "description", "priority", "assignee_id")):
        return JsonResponse({"error": "You don't have permission to edit tasks."}, status=403)
 
    task.save()
    _broadcast_taskboard_event(workspace.id, {
        "action": "update",
        "object": "task",
        "task": _serialize_task(task),
    })
    _notify_workspace_users(
        workspace, request.user, 'taskboard', 'task_update',
        f"{request.user.display_name or request.user.username} updated task {task.title}",
        reference_id=task.id,
    )
    return JsonResponse({"success": True, "task": _serialize_task(task)})
 
 
@login_required
@require_POST
def task_delete(request, workspace_id, task_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    task      = get_object_or_404(Task, id=task_id, workspace=workspace)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    ts = _get_or_create_settings(workspace)
    if not _check_perm(ts, "who_can_delete_tasks", workspace, request.user):
        return JsonResponse({"error": "You don't have permission to delete tasks."}, status=403)
    task.delete()
    _broadcast_taskboard_event(workspace.id, {
        "action": "delete",
        "object": "task",
        "task_id": task_id,
    })
    _notify_workspace_users(
        workspace, request.user, 'taskboard', 'task_delete',
        f"{request.user.display_name or request.user.username} deleted a task",
        reference_id=task_id,
    )
    return JsonResponse({"success": True})
 
 
# ─── attachments ──────────────────────────────────────────────────────────────
 
@login_required
@require_POST
def task_attachment_upload(request, workspace_id, task_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    task      = get_object_or_404(Task, id=task_id, workspace=workspace)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    ts = _get_or_create_settings(workspace)
    if not ts.allow_attachments:
        return JsonResponse({"error": "Attachments are disabled for this board."}, status=403)
    if not _check_perm(ts, "who_can_attach_files", workspace, request.user):
        return JsonResponse({"error": "You don't have permission to attach files."}, status=403)
 
    att_type = request.POST.get("type", "document")
 
    if att_type == "link":
        url = request.POST.get("url", "").strip()
        if not url:
            return JsonResponse({"error": "URL is required"}, status=400)
        if not url.lower().startswith(("http://", "https://")):
            url = f"https://{url}"
        current_links = task.attachments.filter(attachment_type="link").count()
        if current_links >= TaskAttachment.LINK_COUNT_MAX:
            return JsonResponse({"error": "Each task can have at most 5 links."}, status=400)
        att = TaskAttachment.objects.create(
            task=task, uploaded_by=request.user,
            attachment_type="link", link_url=url, original_name=url,
        )
        return JsonResponse({"success": True, "attachment": {
            "id": att.id, "type": "link", "original_name": att.original_name,
            "link_url": att.link_url, "url": None, "file_size": 0,
            "uploaded_by": request.user.display_name or request.user.username,
            "created_at": att.created_at.isoformat(),
        }})
 
    file = request.FILES.get("file")
    if not file:
        return JsonResponse({"error": "No file provided"}, status=400)
 
    current_count = task.attachments.filter(attachment_type=att_type).count()
    if att_type == "image" and current_count >= TaskAttachment.IMAGE_COUNT_MAX:
        return JsonResponse({"error": "Each task can have at most 10 images."}, status=400)
    if att_type == "video" and current_count >= TaskAttachment.VIDEO_COUNT_MAX:
        return JsonResponse({"error": "Each task can have at most 5 videos."}, status=400)
    if att_type == "document" and current_count >= TaskAttachment.DOC_COUNT_MAX:
        return JsonResponse({"error": "Each task can have at most 5 documents."}, status=400)

    LIMITS = {
        "image":    TaskAttachment.IMAGE_MAX,
        "video":    TaskAttachment.VIDEO_MAX,
        "document": TaskAttachment.DOC_MAX,
    }
    limit = LIMITS.get(att_type, TaskAttachment.DOC_MAX)
    if file.size > limit:
        limit_mb = limit / (1024 * 1024)
        return JsonResponse(
            {"error": f"{att_type.title()} must be under {limit_mb:.0f} MB "
                      f"(your file is {file.size/(1024*1024):.1f} MB)"},
            status=400
        )

    allowed_extensions = {
        "image": ALLOWED_IMAGE_EXTENSIONS,
        "video": ALLOWED_VIDEO_EXTENSIONS,
        "document": ALLOWED_DOC_EXTENSIONS,
    }.get(att_type, ALLOWED_DOC_EXTENSIONS)

    if not _has_allowed_extension(file.name, allowed_extensions):
        return JsonResponse({"error": f"Invalid {att_type} file type."}, status=400)

    storage_folder = f"task_attachments/{task.workspace_id}/{task.id}"
    file_path = build_storage_path(storage_folder, file.name)
    upload_file(file_path, file, file.content_type)

    att = TaskAttachment.objects.create(
        task=task, uploaded_by=request.user,
        attachment_type=att_type, file=file_path,
        original_name=file.name, file_size=file.size,
    )
    return JsonResponse({"success": True, "attachment": {
        "id": att.id, "type": att.attachment_type,
        "original_name": att.original_name, "file_size": att.file_size,
        "link_url": "", "url": att.url,
        "uploaded_by": request.user.display_name or request.user.username,
        "created_at": att.created_at.isoformat(),
    }})
 
 
@login_required
@require_POST
def task_attachment_delete(request, workspace_id, task_id, att_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    att       = get_object_or_404(TaskAttachment, id=att_id, task_id=task_id)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    # Only uploader or workspace admin may delete
    if att.uploaded_by_id != request.user.id and not _is_admin(workspace, request.user):
        return JsonResponse({"error": "Permission denied."}, status=403)
    if att.file:
        delete_file(att.file)
    att.delete()
    return JsonResponse({"success": True})
 
 
# ─── comments ─────────────────────────────────────────────────────────────────
 
@login_required
@require_POST
def task_comment_create(request, workspace_id, task_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    task      = get_object_or_404(Task, id=task_id, workspace=workspace)
    if not _is_member(workspace, request.user):
        return JsonResponse({"error": "Not a member"}, status=403)
    ts = _get_or_create_settings(workspace)
    if not ts.allow_comments:
        return JsonResponse({"error": "Comments are disabled for this board."}, status=403)
    if not _check_perm(ts, "who_can_comment", workspace, request.user):
        return JsonResponse({"error": "You don't have permission to comment."}, status=403)
 
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
 
    text = body.get("text", "").strip()
    if not text:
        return JsonResponse({"error": "Comment cannot be empty."}, status=400)
 
    c = TaskComment.objects.create(task=task, author=request.user, text=text)
    comment_payload = {
        "id": c.id,
        "author": c.author.display_name or c.author.username,
        "author_avatar": c.author.profile_picture_url if c.author.profile_picture else None,
        "text": c.text,
        "created_at": c.created_at.isoformat(),
    }
    _broadcast_taskboard_event(workspace.id, {
        "action": "create",
        "object": "comment",
        "task_id": task.id,
        "comment": comment_payload,
    })
    _notify_workspace_users(
        workspace, request.user, 'taskboard', 'task_comment',
        f"{request.user.display_name or request.user.username} commented on {task.title}",
        reference_id=task.id,
    )
    return JsonResponse({"success": True, "comment": comment_payload}, status=201)
 

#  ------------------------ AI Page Logic --------------------------------
@login_required
def ai_page(request, workspace_id):
    membership = WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).first()

    if not membership:
        messages.error(request, "You are not part of this workspace.")
        return redirect("workspace")

    workspace = membership.workspace

    members = WorkspaceMembership.objects.filter(
        workspace=workspace
    ).select_related("user")

    # exclude yourself from DM list
    dm_members = members.exclude(user=request.user)

    notification_counts = _get_notification_counts(workspace, request.user)

    return render(request, "ai.html", {
        "workspace": workspace,
        "members": members,
        "dm_members": dm_members,
        "notification_counts": notification_counts,
        "notification_counts_json": json.dumps(notification_counts),
        "is_ai_page": True,
        "base_template": "base_layout.html",
    })

# Minimal AI chat API used by frontend `/api/ai-chat/` (keeps existing functionality)

@login_required
@require_POST
def ai_chat(request, workspace_id):
    """
    POST /api/workspace/<workspace_id>/ai-chat/
    Body: { "message": "..." }
    Returns: { "response": "...", "history": [ {role, content, created_at}, ... ] }
 
    Saves both the user turn and the assistant reply to AIMessage,
    then returns the full conversation history for this (workspace, user).
    """
    # ── Membership check ──────────────────────────────────────────────────────
    if not WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).exists():
        return JsonResponse({'error': 'not a member'}, status=403)
 
    # ── Parse body ────────────────────────────────────────────────────────────
    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except ValueError:
        return JsonResponse({'error': 'Invalid JSON.'}, status=400)
 
    user_message = (payload.get('message') or '').strip()
    if not user_message:
        return JsonResponse({'error': 'Message is required.'}, status=400)
 
    workspace = get_object_or_404(Workspace, id=workspace_id)
 
    # ── Save the user's message ───────────────────────────────────────────────
    AIMessage.objects.create(
        workspace=workspace,
        user=request.user,
        role='user',
        content=user_message,
    )
 
    # ── Get AI response ───────────────────────────────────────────────────────
    response_text = get_response(user_message)
 
    # ── Save the assistant's reply ────────────────────────────────────────────
    AIMessage.objects.create(
        workspace=workspace,
        user=request.user,
        role='assistant',
        content=response_text,
    )
 
    return JsonResponse({'response': response_text})
 

@login_required
@require_POST
def ai_chat_legacy(request):
    """Legacy endpoint for requests without a workspace ID in the URL."""
    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except ValueError:
        return JsonResponse({'error': 'Invalid JSON.'}, status=400)

    workspace_id = payload.get('workspace_id')
    if workspace_id:
        return ai_chat(request, workspace_id)

    memberships = WorkspaceMembership.objects.filter(user=request.user)
    if memberships.count() == 1:
        return ai_chat(request, memberships.first().workspace_id)

    referer = request.META.get('HTTP_REFERER', '')
    match = re.search(r'/workspace/(\d+)/|/chatui/(\d+)/|/taskboard/(\d+)/|/ai-chat/(\d+)/', referer)
    if match:
        workspace_id = next((group for group in match.groups() if group), None)
        if workspace_id:
            return ai_chat(request, int(workspace_id))

    return JsonResponse({'error': 'Workspace ID required for legacy AI endpoint.'}, status=400)


def ai(request, workspace_id):
    membership = WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).first()

    if not membership:
        messages.error(request, "You are not part of this workspace.")
        return redirect("workspace")

    workspace = membership.workspace
    members = WorkspaceMembership.objects.filter(
        workspace=workspace
    ).select_related("user")
    dm_members = members.exclude(user=request.user)
    notification_counts = _get_notification_counts(workspace, request.user)

    return render(request, 'ai.html', {
        'workspace': workspace,
        'members': members,
        'dm_members': dm_members,
        'notification_counts': notification_counts,
        'notification_counts_json': json.dumps(notification_counts),
        'is_ai_page': True,
        'base_template': 'base_layout.html',
    })

@login_required
def ai_history(request, workspace_id):
    """
    GET /api/workspace/<workspace_id>/ai-history/
    Returns the full AI conversation history for the current user
    in this workspace, ordered oldest-first.
    Used on page load to restore the chat panel.
    """
    if not WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).exists():
        return JsonResponse({'error': 'not a member'}, status=403)
 
    messages_qs = AIMessage.objects.filter(
        workspace_id=workspace_id,
        user=request.user,
    ).order_by('created_at')
 
    history = [
        {
            'role':       m.role,
            'content':    m.content,
            'created_at': m.created_at.isoformat(),
        }
        for m in messages_qs
    ]
 
    return JsonResponse({'history': history})
 
 
@login_required
@require_POST
def ai_clear_history(request, workspace_id):
    """
    POST /api/workspace/<workspace_id>/ai-clear-history/
    Deletes all AI messages for the current user in this workspace.
    """
    if not WorkspaceMembership.objects.filter(
        user=request.user, workspace_id=workspace_id
    ).exists():
        return JsonResponse({'error': 'not a member'}, status=403)
 
    deleted_count, _ = AIMessage.objects.filter(
        workspace_id=workspace_id,
        user=request.user,
    ).delete()
 
    return JsonResponse({'success': True, 'deleted': deleted_count})
 