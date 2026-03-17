# Generated migration for Invitation model

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('kollabapp', '0009_directmessage'),
    ]

    operations = [
        migrations.CreateModel(
            name='Invitation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('recipient_email', models.EmailField(blank=True, max_length=254, null=True)),
                ('role', models.CharField(choices=[('admin', 'Admin'), ('member', 'Member')], default='member', max_length=10)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('accepted', 'Accepted')], default='pending', max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('accepted_at', models.DateTimeField(blank=True, null=True)),
                ('invited_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='sent_invitations', to=settings.AUTH_USER_MODEL)),
                ('recipient_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='received_invitations', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='invitations', to='kollabapp.workspace')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
