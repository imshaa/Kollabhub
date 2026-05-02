
from django.contrib import admin
from django.urls import path
from . import views


urlpatterns = [
    # path('chatui/', views.chatui, name='chatui'),
    path("chatui/<int:workspace_id>/", views.chatui, name="chatui"),
    path("ai-chat/<int:workspace_id>/", views.ai_page, name="ai_page"),
    path("api/workspace/<int:workspace_id>/messages/", views.messages_api, name="messages_api"),
    path("api/workspace/<int:workspace_id>/members/", views.members_api, name="members_api"),
    path("api/workspace/<int:workspace_id>/send-invitation/", views.send_invitation, name="send_invitation"),
    path("api/workspace/<int:workspace_id>/sent-invitations/", views.get_sent_invitations, name="get_sent_invitations"),
    path("api/workspace/<int:workspace_id>/transfer-ownership/", views.transfer_ownership, name="transfer_ownership"),
    path("api/workspace/<int:workspace_id>/leave-workspace/", views.leave_workspace, name="leave_workspace"),
    path("api/workspace/<int:workspace_id>/delete-workspace/", views.delete_workspace_api, name="delete_workspace_api"),
    path("api/workspace/<int:workspace_id>/privacy-settings/", views.get_privacy_settings, name="get_privacy_settings"),
    path("api/workspace/<int:workspace_id>/update-privacy-settings/", views.update_privacy_settings, name="update_privacy_settings"),
    path("api/workspace/<int:workspace_id>/update-info/", views.update_workspace_info, name="update_workspace_info"),
    path("api/workspace/<int:workspace_id>/cleanup-messages/", views.cleanup_old_messages, name="cleanup_old_messages"),
    path("api/workspace/<int:workspace_id>/notifications/counts/", views.notification_counts_api, name="notification_counts_api"),
    path("api/workspace/<int:workspace_id>/notifications/mark-read/", views.notification_mark_read, name="notification_mark_read"),
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
 
# Taskboard settings
    path("api/workspace/<int:workspace_id>/taskboard-settings/",        views.taskboard_settings_get,    name="taskboard_settings_get"),
    path("api/workspace/<int:workspace_id>/taskboard-settings/update/", views.taskboard_settings_update, name="taskboard_settings_update"),
 
# Task Lists
    path("api/workspace/<int:workspace_id>/lists/",                             views.tasklists_api,   name="tasklists_api"),
    path("api/workspace/<int:workspace_id>/lists/create/",                      views.tasklist_create, name="tasklist_create"),
    path("api/workspace/<int:workspace_id>/lists/<int:list_id>/update/",        views.tasklist_update, name="tasklist_update"),
    path("api/workspace/<int:workspace_id>/lists/<int:list_id>/delete/",        views.tasklist_delete, name="tasklist_delete"),
 
# Tasks
    path("api/workspace/<int:workspace_id>/tasks/",                             views.tasks_api,    name="tasks_api"),
    path("api/workspace/<int:workspace_id>/tasks/create/",                      views.task_create,  name="task_create"),
    path("api/workspace/<int:workspace_id>/tasks/<int:task_id>/update/",        views.task_update,  name="task_update"),
    path("api/workspace/<int:workspace_id>/tasks/<int:task_id>/delete/",        views.task_delete,  name="task_delete"),
 
# Attachments
    path("api/workspace/<int:workspace_id>/tasks/<int:task_id>/attachments/upload/",
     views.task_attachment_upload, name="task_attachment_upload"),
    path("api/workspace/<int:workspace_id>/tasks/<int:task_id>/attachments/<int:att_id>/delete/",
     views.task_attachment_delete, name="task_attachment_delete"),
 
# Comments
     path("api/workspace/<int:workspace_id>/tasks/<int:task_id>/comments/",
     views.task_comment_create, name="task_comment_create"),


]
