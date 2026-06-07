import pandas as pd
import pickle
import os
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.svm import LinearSVC
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
import numpy as np

# ============================================================
# KollabHub — Tier 2 NLP Model Training Script
# Author: Almas
# Model: TF-IDF + LinearSVC (Support Vector Machine)
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(BASE_DIR, "dataset.csv")
MODEL_PATH   = os.path.join(BASE_DIR, "intent_model.pkl")
VECTOR_PATH  = os.path.join(BASE_DIR, "vectorizer.pkl")

# ── Step 1: Load dataset ─────────────────────────────────────
print("Step 1: Loading dataset...")
df = pd.read_csv(DATASET_PATH)
print(f"         Total samples loaded: {len(df)}")
print(f"         Intents found: {df['intent'].nunique()}")
print(f"         Intent list: {list(df['intent'].unique())}\n")

# ── Step 2: Prepare data ─────────────────────────────────────
print("Step 2: Preparing data...")
X = df["text"].astype(str).str.lower().str.strip()
y = df["intent"]

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)
print(f"         Training samples : {len(X_train)}")
print(f"         Testing samples  : {len(X_test)}\n")

# ── Step 3: TF-IDF Vectorizer ────────────────────────────────
print("Step 3: Building TF-IDF vectorizer...")
vectorizer = TfidfVectorizer(
    ngram_range=(1, 2),
    max_features=5000,
    sublinear_tf=True
)
X_train_vec = vectorizer.fit_transform(X_train)
X_test_vec  = vectorizer.transform(X_test)
print(f"         Vocabulary size: {len(vectorizer.vocabulary_)}\n")

# ── Step 4: Train LinearSVC model ────────────────────────────
print("Step 4: Training LinearSVC model...")
model = LinearSVC(C=1.0, max_iter=1000)
model.fit(X_train_vec, y_train)
print("         Model training complete.\n")

# ── Step 5: Evaluate ─────────────────────────────────────────
print("Step 5: Evaluating model...")
y_pred = model.predict(X_test_vec)
accuracy = accuracy_score(y_test, y_pred)

print(f"\n{'='*50}")
print(f"  ACCURACY: {accuracy * 100:.2f}%")
print(f"{'='*50}\n")
print("  Detailed Report:")
print(classification_report(y_test, y_pred))

# ── Step 6: Save model and vectorizer ────────────────────────
print("Step 6: Saving model and vectorizer...")
with open(MODEL_PATH, "wb") as f:
    pickle.dump(model, f)
with open(VECTOR_PATH, "wb") as f:
    pickle.dump(vectorizer, f)
print(f"         Model saved     : {MODEL_PATH}")
print(f"         Vectorizer saved: {VECTOR_PATH}\n")

# ── Step 7: Quick test ───────────────────────────────────────
print("Step 7: Quick prediction test...")
test_sentences = [
    "hello there",
    "i want to create a task",
    "what is the deadline",
    "invite a new member",
    "show my tasks",
    "tsk bnao",
    "update my profile",
    "goodbye",
]

with open(MODEL_PATH, "rb") as f:
    loaded_model = pickle.load(f)
with open(VECTOR_PATH, "rb") as f:
    loaded_vec = pickle.load(f)

print(f"\n  {'Input':<35} {'Predicted Intent'}")
print(f"  {'-'*35} {'-'*20}")
for sentence in test_sentences:
    vec  = loaded_vec.transform([sentence.lower()])
    pred = loaded_model.predict(vec)[0]
    print(f"  {sentence:<35} {pred}")

print(f"\n{'='*50}")
print("  Tier 2 model training complete.")
print("  Files saved in ml_model folder.")
print(f"{'='*50}\n")