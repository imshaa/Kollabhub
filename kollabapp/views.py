from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth import get_user_model
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from .models import CustomUser
from .models import Workspace
from .models import WorkspaceMembership
from .models import Message
from .models import DirectMessage
from .models import Invitation
import json
from django.http import JsonResponse
from django.db import models
from django.db.models import Q
from django.utils import timezone
from datetime import timedelta


User = get_user_model()  # This gets CustomUser


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
        return redirect("profile")

    return render(request, "signup.html")


def login_view(request):
    # if already logged in, send to profile/home
    if request.user.is_authenticated:
        return redirect("profile")

    if request.method == "POST":
        username = request.POST.get("username")
        password = request.POST.get("password")

        user = authenticate(request, username=username, password=password)

        if user is not None:
            login(request, user)
            return redirect("profile")
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
    # display workspace grid and profile modal (no creation form any more)
    user = request.user
    memberships = WorkspaceMembership.objects.filter(user=user).select_related("workspace")
    workspaces = [m.workspace for m in memberships]
    return render(request, "profile.html", {
        "user": user,
        "workspaces": workspaces,
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
            user.profile_picture = profile_picture

        user.save()
        messages.success(request, "Profile updated successfully.")
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
        return redirect("profile")

    workspace = membership.workspace

    members = WorkspaceMembership.objects.filter(
        workspace=workspace
    ).select_related("user")

    # exclude yourself from DM list
    dm_members = members.exclude(user=request.user)

    return render(request, "chatui.html", {
        "workspace": workspace,
        "members": members,
        "dm_members": dm_members
    })
# ------------------------------ TaskBoard logic---------------------------
def taskboard(request, workspace_id):
    workspace = Workspace.objects.get(id=workspace_id)

    return render(request, "taskboard.html", {
        "workspace": workspace
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
            return redirect("profile")

        if not image:
            messages.error(request, "Workspace image is required.")
            return redirect("profile")

        # NEW LIMIT: max 50 workspaces total (admin + member)
        total_memberships = WorkspaceMembership.objects.filter(
            user=request.user
        ).count()

        if total_memberships >= 50:
            messages.error(request, "You cannot be part of more than 50 workspaces.")
            return redirect("profile")

        workspace, created = Workspace.objects.get_or_create(
            title=title,
            admin=request.user,
            defaults={
                "display_name": display_name if display_name else None,
                "description": description,
                "team_email": team_email if team_email else None,
                "visibility": visibility,
                "image": image,
            },
        )

        if not created:
            workspace.display_name = display_name if display_name else None
            workspace.description = description
            workspace.team_email = team_email if team_email else None
            workspace.visibility = visibility

            if image:
                workspace.image.delete(save=False)
                workspace.image = image

            workspace.save()

            messages.success(request, f"Workspace '{title}' updated successfully!")
        else:
            WorkspaceMembership.objects.create(
                workspace=workspace,
                user=request.user,
                role="admin"
            )
            messages.success(request, f"Workspace '{title}' created successfully!")


        return redirect("chatui", workspace_id=workspace.id)

    return redirect("profile")


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
            'sender_avatar': m.sender.profile_picture.url if (m.sender and m.sender.profile_picture) else '/static/Areeba.jpeg',
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
        "profile_picture": user.profile_picture.url if user.profile_picture else "",
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
                "avatar": m.user.profile_picture.url if m.user.profile_picture else None,
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

