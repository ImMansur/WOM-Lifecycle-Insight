import firebase_admin
from firebase_admin import credentials, auth
import os
import json

# Initialize Firebase Admin
if not firebase_admin._apps:
    service_account_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "{}")
    cred = credentials.Certificate(json.loads(service_account_json))
    firebase_admin.initialize_app(cred)

def create_admin_user(email, password, display_name):
    try:
        user = auth.create_user(
            email=email,
            password=password,
            display_name=display_name
        )
        print(f"Successfully created new user: {user.uid}")
        return user
    except Exception as e:
        print(f"Error creating user: {e}")
        return None

if __name__ == "__main__":
    email = "admin@womgroup.com"
    password = "SecurePassword123!"
    display_name = "System Administrator"
    
    print(f"Creating admin account: {email}...")
    create_admin_user(email, password, display_name)
    print("\nDone! You can now log in with these credentials.")
