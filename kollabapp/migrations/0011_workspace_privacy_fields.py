# Generated migration for privacy fields

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('kollabapp', '0010_invitation'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspace',
            name='invites_restricted_to_admins',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='workspace',
            name='message_retention_days',
            field=models.IntegerField(blank=True, default=None, null=True),
        ),
    ]
