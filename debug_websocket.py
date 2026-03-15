"""
WebSocket Debugging Script
Run this in your Django shell to verify everything is set up correctly:
    python manage.py shell < debug_websocket.py
"""

print("\n" + "="*60)
print("WEBSOCKET CONFIGURATION DEBUG")
print("="*60)

# Check 1: Django Settings
print("\n[1] Django Settings Check")
print("-" * 60)

from django.conf import settings

print(f"✓ ASGI_APPLICATION: {settings.ASGI_APPLICATION}")
print(f"✓ Installed Apps: {', '.join([app for app in settings.INSTALLED_APPS if 'channel' in app.lower() or 'kollab' in app.lower()])}")

channel_layers = settings.CHANNEL_LAYERS
if channel_layers:
    print(f"✓ Channel Layers Backend: {channel_layers['default']['BACKEND']}")
    print(f"✓ Redis Host: {channel_layers['default']['CONFIG']['hosts']}")
else:
    print("✗ No CHANNEL_LAYERS configured!")

# Check 2: Database & User Model
print("\n[2] Database & User Model Check")
print("-" * 60)

from django.contrib.auth import get_user_model
from kollabapp.models import Workspace, WorkspaceMembership

User = get_user_model()
print(f"✓ User Model: {User}")
print(f"✓ User Table: {User._meta.db_table}")

user_count = User.objects.count()
print(f"✓ Total Users: {user_count}")

workspace_count = Workspace.objects.count()
print(f"✓ Total Workspaces: {workspace_count}")

# Check 3: Sample User & Workspace
print("\n[3] Sample Data Check")
print("-" * 60)

if user_count > 0:
    sample_user = User.objects.first()
    print(f"✓ Sample User: {sample_user.username}")
    print(f"  - Display Name: {sample_user.display_name}")
    print(f"  - Profile Picture: {sample_user.profile_picture if sample_user.profile_picture else 'None'}")
    print(f"  - Email: {sample_user.email}")

if workspace_count > 0:
    sample_workspace = Workspace.objects.first()
    print(f"✓ Sample Workspace: {sample_workspace.title} (ID: {sample_workspace.id})")
    print(f"  - Members: {sample_workspace.members.count()}")
    print(f"  - Image: {sample_workspace.image if sample_workspace.image else 'None'}")

# Check 4: Routing
print("\n[4] WebSocket Routing Check")
print("-" * 60)

try:
    from kollabapp.routing import websocket_urlpatterns
    print(f"✓ WebSocket URL Patterns Loaded: {len(websocket_urlpatterns)} pattern(s)")
    for pattern in websocket_urlpatterns:
        print(f"  - {pattern.pattern}")
except Exception as e:
    print(f"✗ Error loading routing: {e}")

# Check 5: Consumer
print("\n[5] WebSocket Consumer Check")
print("-" * 60)

try:
    from kollabapp.consumers import ChatConsumer
    print(f"✓ ChatConsumer imported successfully")
    print(f"  - Base Classes: {[base.__name__ for base in ChatConsumer.__bases__]}")
    
    # Check methods
    methods = ['connect', 'disconnect', 'receive', 'chat_message', 'get_user_data']
    for method in methods:
        has_method = hasattr(ChatConsumer, method)
        print(f"  - {'✓' if has_method else '✗'} {method}()")
except Exception as e:
    print(f"✗ Error loading consumer: {e}")

# Check 6: Redis Connection
print("\n[6] Redis Connection Check")
print("-" * 60)

try:
    import redis
    r = redis.Redis(host='127.0.0.1', port=6379, decode_responses=True)
    ping = r.ping()
    if ping:
        print(f"✓ Redis is running!")
        print(f"✓ Redis Version: {r.info()['redis_version']}")
    else:
        print("✗ Redis not responding")
except Exception as e:
    print(f"✗ Redis connection failed: {e}")
    print("  Make sure Redis is running: redis-server")

# Check 7: Templates
print("\n[7] Template Check")
print("-" * 60)

import os
from django.conf import settings

template_path = os.path.join(settings.BASE_DIR, 'templates', 'chatui.html')
if os.path.exists(template_path):
    print(f"✓ chatui.html found at: {template_path}")
    with open(template_path, 'r') as f:
        content = f.read()
        has_data_attrs = 'data-workspace-id' in content
        has_old_template = '{{ workspace.id }}' in content
        print(f"  - {'✓' if has_data_attrs else '✗'} Has data-workspace-id attribute")
        print(f"  - {'✗ OLD TEMPLATE' if has_old_template else '✓ Using proper attributes'}")
else:
    print(f"✗ chatui.html not found!")

# Check 8: Static Files
print("\n[8] Static Files Check")
print("-" * 60)

chatui_js_path = os.path.join(settings.BASE_DIR, 'static', 'chatui.js')
if os.path.exists(chatui_js_path):
    print(f"✓ chatui.js found at: {chatui_js_path}")
    with open(chatui_js_path, 'r') as f:
        content = f.read()
        has_old_template = '{{ workspace.id }}' in content
        has_data_attrs = 'dataset.workspaceId' in content
        print(f"  - {'✗ OLD TEMPLATE TAGS' if has_old_template else '✓ No template tags'}")
        print(f"  - {'✓' if has_data_attrs else '✗'} Uses dataset attributes")
else:
    print(f"✗ chatui.js not found!")

# Summary
print("\n" + "="*60)
print("DEBUGGING SUMMARY")
print("="*60)
print("""
Next Steps:
1. Verify all ✓ checks above
2. Start Django: python manage.py runserver
3. Start Redis: redis-server (in another terminal)
4. Open browser and navigate to /chatui/1/
5. Open DevTools (F12) and check Console for connection logs
6. Open Network tab and filter by WS (WebSocket)
7. Send a message and verify frames appear
8. Check that messages appear in both connected clients

If Redis is not installed:
    - Windows: https://github.com/microsoftarchive/redis/releases
    - WSL/Linux: sudo apt-get install redis-server
    - macOS: brew install redis
""")
print("="*60 + "\n")
