
from django.contrib import admin
from django.urls import path
from . import views


urlpatterns = [
    # path('chatui/', views.chatui, name='chatui'),
    path("chatui/<int:workspace_id>/", views.chatui, name="chatui"),
    path("api/workspace/<int:workspace_id>/messages/", views.messages_api, name="messages_api"),
    path("api/workspace/<int:workspace_id>/members/", views.members_api, name="members_api"),
    path("api/workspace/<int:workspace_id>/send-invitation/", views.send_invitation, name="send_invitation"),
    path("api/workspace/<int:workspace_id>/sent-invitations/", views.get_sent_invitations, name="get_sent_invitations"),
    path("api/workspace/<int:workspace_id>/transfer-ownership/", views.transfer_ownership, name="transfer_ownership"),
    path("api/workspace/<int:workspace_id>/leave-workspace/", views.leave_workspace, name="leave_workspace"),
    path("api/workspace/<int:workspace_id>/delete-workspace/", views.delete_workspace_api, name="delete_workspace_api"),
    path("api/workspace/<int:workspace_id>/privacy-settings/", views.get_privacy_settings, name="get_privacy_settings"),
    path("api/workspace/<int:workspace_id>/update-privacy-settings/", views.update_privacy_settings, name="update_privacy_settings"),
    path("api/workspace/<int:workspace_id>/cleanup-messages/", views.cleanup_old_messages, name="cleanup_old_messages"),
    path('', views.home, name='home'),
    path('update_profile/', views.update_profile, name='update_profile'),
    path('signup/', views.signup_view, name='signup'),
    path('workspace/', views.workspace, name='workspace'),
    path('profile/', views.profile, name='profile'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('workspace/join/', views.join_workspace_manual, name='join_workspace_manual'),
    path('workspace/<int:workspace_id>/add-member/', views.add_member_manual, name='add_member_manual'),
    path("workspace/<int:workspace_id>/remove-member/", views.remove_member, name="remove_member"),
    path("workspace/<int:workspace_id>/delete/", views.delete_workspace, name="delete_workspace"),
    path("api/profile/", views.profile_api, name="profile_api"),
    path('api/workspace/<int:workspace_id>/dm/<int:user_id>/',views.direct_messages_api, name='direct_messages_api'),
    path('api/workspace/<int:workspace_id>/send-dm/', views.send_dm, name='send_dm'),
    path("api/workspace/<int:workspace_id>/invite-links/", views.get_invite_links),
    path("api/workspace/<int:workspace_id>/create-invite/", views.create_invite_link),
    path("api/invite/<int:invite_id>/revoke/", views.revoke_invite),
    path("invite/<uuid:token>/", views.join_workspace_invite),
            # ---Taskboard-----
    path("taskboard/<int:workspace_id>/", views.taskboard, name="taskboard"),

] 