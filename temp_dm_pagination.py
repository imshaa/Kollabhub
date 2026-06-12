from django.contrib.auth import get_user_model
from kollabapp.models import Workspace, DirectMessage
from django.db.models import Q
import time
from django.db import transaction
User = get_user_model()
u1, _ = User.objects.get_or_create(username='dm_pagination_user1', defaults={'email':'dm1@example.com'})
u2, _ = User.objects.get_or_create(username='dm_pagination_user2', defaults={'email':'dm2@example.com'})
ws, _ = Workspace.objects.get_or_create(name='dm_pagination_workspace', defaults={'display_name':'DM Pagination Workspace', 'owner':u1, 'privacy':'private'})
DirectMessage.objects.filter(workspace=ws, sender__in=[u1,u2], receiver__in=[u1,u2]).delete()
msgs=[]
with transaction.atomic():
    for i in range(53):
        sender = u1 if i % 2 == 0 else u2
        receiver = u2 if sender is u1 else u1
        dm = DirectMessage.objects.create(workspace=ws, sender=sender, receiver=receiver, message=f'msg{i}')
        msgs.append(dm)
        time.sleep(0.001)
print('created', len(msgs))
qs = DirectMessage.objects.filter(Q(sender=u1, receiver=u2)|Q(sender=u2, receiver=u1), workspace=ws).order_by('-created_at','-id')
print('total', qs.count())
batch = list(qs[:51])
print('batch len', len(batch))
print('first 3 ids', [m.id for m in batch[:3]])
print('last 3 ids', [m.id for m in batch[-3:]])
limit=50
msgs_batch = list(reversed(batch[:limit]))
print('msgs_batch len', len(msgs_batch))
print('cursor', msgs_batch[0].created_at.isoformat()+'|'+str(msgs_batch[0].id))
cursor_created_at = msgs_batch[0].created_at
cursor_id = msgs_batch[0].id
older = list(qs.filter(Q(created_at__lt=cursor_created_at) | Q(created_at=cursor_created_at, id__lt=cursor_id))[:11])
print('older len', len(older))
print('older ids', [m.id for m in older])