"""Resilient Firestore store that handles key formatting issues."""
from __future__ import annotations

import logging
import os
import json
from typing import List, Optional

import firebase_admin
from firebase_admin import credentials, firestore
from models import Recommendation, Action

# Initialize Firebase Admin
def initialize_firestore():
    service_account_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not service_account_json:
        logging.error("FIREBASE_SERVICE_ACCOUNT_JSON env var not set.")
        return None

    try:
        if firebase_admin._apps:
            return firestore.client()

        cert_dict = json.loads(service_account_json)

        # Fix the private key formatting on the fly
        key = cert_dict.get("private_key", "")
        if "\\n" in key:
            key = key.replace("\\n", "\n")
        
        # Ensure it's wrapped correctly and base64 is clean
        if "-----BEGIN PRIVATE KEY-----" in key:
            parts = key.split("-----BEGIN PRIVATE KEY-----")
            header = "-----BEGIN PRIVATE KEY-----"
            footer = "-----END PRIVATE KEY-----"
            content = parts[1].split(footer)[0].strip()
            
            # Remove all whitespace and existing padding
            clean_content = "".join(content.split()).replace("=", "")
            
            # Re-pad properly (base64 needs to be multiple of 4)
            while len(clean_content) % 4 != 0:
                clean_content += "="
            
            # Re-assemble in standard 64-char lines
            formatted_content = ""
            for i in range(0, len(clean_content), 64):
                formatted_content += clean_content[i:i+64] + "\n"
            
            cert_dict["private_key"] = f"{header}\n{formatted_content}{footer}\n"

        cred = credentials.Certificate(cert_dict)
        firebase_admin.initialize_app(cred)
        logging.info("Firebase Admin initialized successfully with on-the-fly key fixing.")
        return firestore.client()
    except Exception as e:
        logging.error(f"Failed to initialize Firestore even with fix: {e}")
        return None

class RecommendationStore:
    def __init__(self) -> None:
        self.db = initialize_firestore()
        self.ready = self.db is not None

    def all(self) -> List[Recommendation]:
        if not self.ready:
            return []
        try:
            docs = self.db.collection("recommendations").stream()
        except Exception as e:
            logging.error(f"Firestore error in all(): {e}")
            return []
        results: List[Recommendation] = []
        for doc in docs:
            try:
                results.append(Recommendation(**doc.to_dict()))
            except Exception as e:
                logging.warning(f"Skipping invalid recommendation doc {doc.id}: {e}")
        return results

    def add(self, rec: Recommendation) -> None:
        if not self.ready:
            # Last ditch attempt to initialize if it failed before
            self.db = initialize_firestore()
            self.ready = self.db is not None
            if not self.ready:
                logging.error("Cannot add: Firestore still not initialized.")
                return

        try:
            self.db.collection("recommendations").document(rec.id).set(rec.model_dump())
            logging.info(f"Recommendation {rec.id} saved to Firestore.")
        except Exception as e:
            logging.error(f"Firestore error in add(): {e}")

    def remove(self, rec_id: str) -> bool:
        if not self.ready: return False
        try:
            doc_ref = self.db.collection("recommendations").document(rec_id)
            if doc_ref.get().exists:
                doc_ref.delete()
                return True
            return False
        except Exception as e:
            logging.error(f"Firestore error in remove(): {e}")
            return False

    def get(self, rec_id: str):
        if not self.ready: return None
        try:
            doc = self.db.collection("recommendations").document(rec_id).get()
            if doc.exists:
                return Recommendation(**doc.to_dict())
            return None
        except Exception as e:
            logging.error(f"Firestore error in get(): {e}")
            return None

    def update(self, rec_id: str, patch: dict) -> bool:
        if not self.ready: return False
        try:
            doc_ref = self.db.collection("recommendations").document(rec_id)
            if doc_ref.get().exists:
                doc_ref.update(patch)
                return True
            return False
        except Exception as e:
            logging.error(f"Firestore error in update(): {e}")
            return False

    def clear(self) -> None:
        if not self.ready: return
        try:
            batch = self.db.batch()
            docs = self.db.collection("recommendations").list_documents()
            for doc in docs:
                batch.delete(doc)
            batch.commit()
        except Exception as e:
            logging.error(f"Firestore error in clear(): {e}")

recommendation_store = RecommendationStore()


class ActionStore:
    """Firestore-backed store for Action Center items."""

    def __init__(self) -> None:
        self.db = initialize_firestore()
        self.ready = self.db is not None

    def all(self) -> List[Action]:
        if not self.ready:
            return []
        try:
            docs = self.db.collection("actions").order_by("createdAt", direction=firestore.Query.DESCENDING).stream()
            return [Action(**doc.to_dict()) for doc in docs]
        except Exception as e:
            logging.error(f"Firestore error in ActionStore.all(): {e}")
            return []

    def get(self, action_id: str) -> Optional[Action]:
        if not self.ready:
            return None
        try:
            doc = self.db.collection("actions").document(action_id).get()
            if doc.exists:
                return Action(**doc.to_dict())
            return None
        except Exception as e:
            logging.error(f"Firestore error in ActionStore.get(): {e}")
            return None

    def add(self, action: Action) -> None:
        if not self.ready:
            return
        try:
            self.db.collection("actions").document(action.id).set(action.model_dump())
            logging.info(f"Action {action.id} saved to Firestore.")
        except Exception as e:
            logging.error(f"Firestore error in ActionStore.add(): {e}")

    def update(self, action_id: str, patch: dict) -> bool:
        if not self.ready:
            return False
        try:
            doc_ref = self.db.collection("actions").document(action_id)
            if doc_ref.get().exists:
                doc_ref.update(patch)
                return True
            return False
        except Exception as e:
            logging.error(f"Firestore error in ActionStore.update(): {e}")
            return False

    def remove(self, action_id: str) -> bool:
        if not self.ready:
            return False
        try:
            doc_ref = self.db.collection("actions").document(action_id)
            if doc_ref.get().exists:
                doc_ref.delete()
                return True
            return False
        except Exception as e:
            logging.error(f"Firestore error in ActionStore.remove(): {e}")
            return False


action_store = ActionStore()
