from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth import get_user_model
from django.views.decorators.http import require_POST, require_GET
from django.contrib import messages
from django.contrib import messages as django_messages
from django.contrib.auth.decorators import login_required
from pathlib import Path
from .supabase_storage import build_storage_path, create_signed_url, delete_file, upload_file
from .models import CustomUser
from .models import Workspace
from .models import WorkspaceMembership
from .models import Message
from .models import DirectMessage
from .models import Invitation
from .models import Task
from .models import TaskList, TaskComment, TaskAttachment, TaskboardSettings, Notification
import json
from django.http import JsonResponse
from django.db import models
from django.db.models import Q, Count
from django.utils import timezone
from datetime import timedelta
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

User = get_user_model()  # This gets CustomUser

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mp3"}
ALLOWED_DOC_EXTENSIONS = {".docx", ".pdf", ".doc", ".txt"}

def _has_allowed_extension(filename, allowed_extensions):
    return Path(filename).suffix.lower() in allowed_extensions


# ------------------------- signup View/Login/Logout ----------------------------------
def signup_view(request):
    if request.method == "POST":
        username = request.POST.get("username")
        email = request.POST.get("email")
        password = request.POST.get("password")
        confirm_password = request.POST.get("confirm_password")

        if password != confirm_password:
            return render(request, "signup.html", {"error": "Passwords do not match"})

        if CustomUser.objects.filter(username=username).exists():
            return render(request, "signup.html", {"error": "Username already exists"})

        if CustomUser.objects.filter(email=email).exists():
            return render(request, "signup.html", {"error": "Email already exists"})

        user = CustomUser.objects.create_user(username=username, email=email, password=password)
        login(request, user)
        return redirect("workspace")

    return render(request, "signup.html")


def login_view(request):
    if request.user.is_authenticated:
        return redirect("workspace")

    if request.method == "POST":
        username = request.POST.get("username")
        password = request.POST.get("password")

        user = authenticate(request, username=username, password=password)

        if user is not None:
            login(request, user)
            return redirect("workspace")
        else:
            return render(request, "login.html", {"error": "Invalid username or password"})

    return render(request, "login.html")


# Logout view
def logout_view(request):
    logout(request)
    return redirect('home')

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
            new_path = build_storage_path("profiles", profile_picture.name)
            upload_file(new_path, profile_picture, profile_picture.content_type)
            if old_path:
                delete_file(old_path)
            user.profile_picture = new_path

        user.save()
        return redirect(request.META.get("HTTP_REFERER", "profile"))

    return redirect("home")



def home(request):
    return render(request, 'home.html')



# To check Workspace Admin.
def is_workspace_admin(user, workspace):
    return WorkspaceMembership.objects.filter(workspace=workspace, user=user, role="admin").exists()


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



# ------------------------------ Workspace logic---------------------------
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
            image_path = build_storage_path("workspace_images", image.name)
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
    
    return render(request, "workspace.html", {
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
        new_path = build_storage_path("workspace_images", image.name)
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

        # the frontend now offers a generic workspace_email field;
        # depending on whether a team email exists we validate accordingly
        email = request.POST.get("workspace_email", "").strip().lower()
        title = request.POST.get("title")

        # first find a workspace with the matching title (case‑insensitive?).
        try:
            workspace = Workspace.objects.get(title=title)
        except Workspace.DoesNotExist:
            messages.error(request, "Workspace not found.")
            return redirect("profile")

        # if a team email was set, joining must use that address
        if workspace.team_email:
            if email != workspace.team_email.lower():
                messages.error(request, "Workspace not found.")
                return redirect("profile")
        else:
            # fall back to the admin's email for lookup
            if email != workspace.admin.email.lower():
                messages.error(request, "Workspace not found.")
                return redirect("profile")

        # CHECK IF PRIVATE
        if workspace.visibility == "private":
            messages.error(request, "It's a private workspace; only admin can add members.")
            return redirect("profile")

        # 50 workspace limit
        total_memberships = WorkspaceMembership.objects.filter(
            user=request.user
        ).count()

        if total_memberships >= 50:
            messages.error(request, "You cannot join more than 50 workspaces.")
            return redirect("profile")

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
# adding members to workspace

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



# ------------------------------------- API's Logic-------------------------------------------

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
        .order_by('created_at')[:limit]
    )

    # serialize in chronological order (oldest first)
    data = []
    for m in msgs:
        data.append({
            'id': m.id,
            'message_id': str(m.message_uuid) if m.message_uuid else None,
            'message': m.message,
            'sender_id': m.sender.id if m.sender else None,
            'sender_username': m.sender.username if m.sender else None,
            'sender_display_name': getattr(m.sender, 'display_name', None) if m.sender else None,
            'sender_avatar': m.sender.profile_picture_url if (m.sender and m.sender.profile_picture) else '/static/Areeba.jpeg',
            'created_at': m.created_at.isoformat(),
        })

    return JsonResponse(data, safe=False)


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
    ).order_by("created_at")

    data = []

    for m in messages:
        data.append({
            "id": m.id,
            "message": m.message,
            "sender_id": m.sender_id,
            "sender": m.sender.username,
            "created_at": m.created_at.isoformat()
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

# Workspace - settings tab logic ---------------------------------------
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



# __________________________INvite Links____________________________________

from django.http import JsonResponse
from .models import WorkspaceInvite

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

from django.shortcuts import get_object_or_404, redirect

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
 