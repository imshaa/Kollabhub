
from django.contrib import admin
from django.urls import path
from . import views


urlpatterns = [

    # ── Auth ──────────────────────────────────────────────────────
    path('signup/',                              views.signup_view,                  name='signup'),
    path('login/',                               views.login_view,                   name='login'),
    path('logout/',                              views.logout_view,                  name='logout'),
    path('forgot-password/',                     views.forgot_password_view,         name='forgot_password'),
    
    # ── Chat page ─────────────────────────────────────
    path("chatui/<int:workspace_id>/", views.chatui, name="chatui"),
    

    # ── Chat page settings─────────────────────────────────────
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
    
    # ── chat page apis ─────────────────────────────────────
    path('api/workspace/<int:workspace_id>/dm/<int:user_id>/',views.direct_messages_api, name='direct_messages_api'),
    path('api/workspace/<int:workspace_id>/send-dm/', views.send_dm, name='send_dm'),
    path('api/workspace/<int:workspace_id>/send-voice-note/',    views.send_voice_note,    name='send_voice_note'),
    path('api/workspace/<int:workspace_id>/send-dm-voice-note/', views.send_dm_voice_note, name='send_dm_voice_note'),
    path('api/workspace/<int:workspace_id>/upload-file/',    views.upload_chat_file, name='upload_chat_file'),
    path('api/workspace/<int:workspace_id>/upload-dm-file/', views.upload_dm_file,   name='upload_dm_file'),
    path('api/chat-file/<int:file_id>/refresh-url/',         views.refresh_file_url, name='refresh_file_url'),
    path("api/workspace/<int:workspace_id>/invite-links/", views.get_invite_links),
    path("api/workspace/<int:workspace_id>/create-invite/", views.create_invite_link),
    path("api/invite/<int:invite_id>/revoke/", views.revoke_invite),
    path("invite/<uuid:token>/", views.join_workspace_invite),

    # ── Calling ─────────────────────────────────────────────────────────────────
    path('api/workspace/<int:workspace_id>/call/start/',               views.start_call,   name='start_call'),
    path('api/workspace/<int:workspace_id>/call/<int:call_id>/join/',  views.join_call,    name='join_call'),
    path('api/workspace/<int:workspace_id>/call/<int:call_id>/end/',   views.end_call,     name='end_call'),
    path('api/workspace/<int:workspace_id>/call/<int:call_id>/decline/', views.decline_call, name='decline_call'),
    path('api/workspace/<int:workspace_id>/call/active/', views.active_call, name='active_call'),

    # ── Notiifications ─────────────────────────────────────
    path("api/workspace/<int:workspace_id>/notifications/counts/", views.notification_counts_api, name="notification_counts_api"),
    path("api/workspace/<int:workspace_id>/notifications/mark-read/", views.notification_mark_read, name="notification_mark_read"),
   
    # ── home page  ─────────────────────────────────────
    path('', views.home, name='home'),
    
    #  ----- profile ------------------------
    path('update_profile/', views.update_profile, name='update_profile'),
    path('profile/', views.profile, name='profile'),
    path("api/profile/", views.profile_api, name="profile_api"),
    
    # ---------Workspace management------------------------
    path('workspace/', views.workspace, name='workspace'),
    path('workspace/join/', views.join_workspace_manual, name='join_workspace_manual'),
    path('workspace/<int:workspace_id>/add-member/', views.add_member_manual, name='add_member_manual'),
    path("workspace/<int:workspace_id>/remove-member/", views.remove_member, name="remove_member"),
    path("workspace/<int:workspace_id>/delete/", views.delete_workspace, name="delete_workspace"),
    
    
            # ---Taskboard-----
    path("taskboard/<int:workspace_id>/", views.taskboard, name="taskboard"),
 
# --------Taskboard settings -----------
    path("api/workspace/<int:workspace_id>/taskboard-settings/",        views.taskboard_settings_get,    name="taskboard_settings_get"),
    path("api/workspace/<int:workspace_id>/taskboard-settings/update/", views.taskboard_settings_update, name="taskboard_settings_update"),
 
# ----------Task Lists------------
    path("api/workspace/<int:workspace_id>/lists/",                             views.tasklists_api,   name="tasklists_api"),
    path("api/workspace/<int:workspace_id>/lists/create/",                      views.tasklist_create, name="tasklist_create"),
    path("api/workspace/<int:workspace_id>/lists/<int:list_id>/update/",        views.tasklist_update, name="tasklist_update"),
    path("api/workspace/<int:workspace_id>/lists/<int:list_id>/delete/",        views.tasklist_delete, name="tasklist_delete"),
 
# ------------Tasks---------------
    path("api/workspace/<int:workspace_id>/tasks/",                             views.tasks_api,    name="tasks_api"),
    path("api/workspace/<int:workspace_id>/tasks/create/",                      views.task_create,  name="task_create"),
    path("api/workspace/<int:workspace_id>/tasks/<int:task_id>/update/",        views.task_update,  name="task_update"),
    path("api/workspace/<int:workspace_id>/tasks/<int:task_id>/delete/",        views.task_delete,  name="task_delete"),
 
#------------- Attachments-------------
    path("api/workspace/<int:workspace_id>/tasks/<int:task_id>/attachments/upload/",
     views.task_attachment_upload, name="task_attachment_upload"),
    path("api/workspace/<int:workspace_id>/tasks/<int:task_id>/attachments/<int:att_id>/delete/",
     views.task_attachment_delete, name="task_attachment_delete"),
 
# ------------Comments----------------
     path("api/workspace/<int:workspace_id>/tasks/<int:task_id>/comments/",
     views.task_comment_create, name="task_comment_create"),

    # AI Urls 
    path("ai-chat/<int:workspace_id>/", views.ai_page, name="ai_page"),
    path("ai/<int:workspace_id>/", views.ai_page, name="ai"),
    path('api/workspace/<int:workspace_id>/ai-chat/',         views.ai_chat,         name='ai_chat'),
    path('api/ai-chat/',                                      views.ai_chat_legacy,  name='ai_chat_legacy'),
    path('api/workspace/<int:workspace_id>/ai-history/',      views.ai_history,      name='ai_history'),
    path('api/workspace/<int:workspace_id>/ai-clear-history/',views.ai_clear_history,name='ai_clear_history'),
 

]
