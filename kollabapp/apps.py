from django.apps import AppConfig


class KollabappConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'kollabapp'

# ------TaskBoard------
from django.urls import path
from . import views

urlpatterns = [
    path('', views.chatui, name='chatui'),
    path('taskboard/', views.taskboard, name='taskboard'),
]