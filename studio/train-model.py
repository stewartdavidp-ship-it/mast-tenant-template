#!/usr/bin/env python3
"""
TF.js Model Training Script for Shir Glassworks Studio Companion

Downloads training images from Firebase Storage, trains a MobileNetV2-based
classifier using transfer learning, and exports a quantized TF.js model.

Prerequisites:
  pip install tensorflow tensorflowjs firebase-admin Pillow

Usage:
  1. Collect training photos using the Studio app (Train mode)
  2. Run: python train-model.py
  3. Deploy the output model/ directory alongside studio/index.html

The script will:
  - Download training images from Firebase Storage
  - Train a MobileNetV2 classifier via transfer learning
  - Export a quantized TFJS model to studio/model/
  - Generate a labels.json mapping indices to product names
"""

import os
import json
import tempfile
import shutil
import numpy as np

# Check dependencies
try:
    import tensorflow as tf
    import tensorflowjs as tfjs
    import firebase_admin
    from firebase_admin import credentials, storage, db
    from PIL import Image
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip install tensorflow tensorflowjs firebase-admin Pillow")
    exit(1)

# ============================================================
# Config
# ============================================================
FIREBASE_PROJECT = os.environ.get("FIREBASE_PROJECT", "mast-platform-prod")
STORAGE_BUCKET = os.environ.get("STORAGE_BUCKET", "mast-platform-prod.firebasestorage.app")
DB_URL = os.environ.get("FIREBASE_DATABASE_URL", "https://mast-platform-prod-default-rtdb.firebaseio.com")
TENANT_ID = os.environ.get("TENANT_ID", "dev")
TRAINING_IMAGES_DB_PATH = f"{TENANT_ID}/admin/training-images"
PRODUCTS_DB_PATH = f"{TENANT_ID}/public/products"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "model")
IMG_SIZE = 224
BATCH_SIZE = 16
EPOCHS = 20
MIN_IMAGES_PER_CLASS = 3

# ============================================================
# Firebase Init
# ============================================================
def init_firebase():
    """Initialize Firebase Admin SDK. Uses default credentials or service account."""
    if firebase_admin._apps:
        return

    # Try default credentials first (works with gcloud auth)
    try:
        firebase_admin.initialize_app(options={
            'storageBucket': STORAGE_BUCKET,
            'databaseURL': DB_URL
        })
        return
    except Exception:
        pass

    # Look for service account key
    sa_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    if sa_path and os.path.exists(sa_path):
        cred = credentials.Certificate(sa_path)
        firebase_admin.initialize_app(cred, {
            'storageBucket': STORAGE_BUCKET,
            'databaseURL': DB_URL
        })
        return

    print("ERROR: No Firebase credentials found.")
    print("Either run 'gcloud auth application-default login' or set GOOGLE_APPLICATION_CREDENTIALS")
    exit(1)

# ============================================================
# Download Training Images
# ============================================================
def download_training_images(tmp_dir):
    """Download training images from Firebase and organize by product."""
    print("Fetching training image metadata from Firebase...")
    ref = db.reference(TRAINING_IMAGES_DB_PATH)
    training_data = ref.get() or {}

    # Get product names
    products_ref = db.reference(PRODUCTS_DB_PATH)
    products = products_ref.get() or {}

    classes = {}
    total = 0

    for product_id, images in training_data.items():
        if not isinstance(images, dict):
            continue

        product_name = products.get(product_id, {}).get('name', product_id)
        image_list = []

        class_dir = os.path.join(tmp_dir, product_id)
        os.makedirs(class_dir, exist_ok=True)

        for img_id, img_meta in images.items():
            url = img_meta.get('url')
            if not url:
                continue

            img_path = os.path.join(class_dir, f"{img_id}.jpg")

            try:
                if url.startswith('data:'):
                    # Base64 data URL — decode directly
                    import base64
                    b64_data = url.split(',', 1)[1]
                    with open(img_path, 'wb') as f:
                        f.write(base64.b64decode(b64_data))
                else:
                    # Regular URL — download
                    import urllib.request
                    urllib.request.urlretrieve(url, img_path)
                image_list.append(img_path)
                total += 1
            except Exception as e:
                print(f"  Failed to load {img_id}: {e}")

        if len(image_list) >= MIN_IMAGES_PER_CLASS:
            classes[product_id] = {
                'name': product_name,
                'images': image_list
            }
            print(f"  {product_name}: {len(image_list)} images")
        else:
            print(f"  {product_name}: {len(image_list)} images (skipped, need >= {MIN_IMAGES_PER_CLASS})")

    print(f"\nTotal: {total} images across {len(classes)} classes")
    return classes

# ============================================================
# Build Dataset
# ============================================================
def load_and_preprocess(path):
    """Load and preprocess a single image for MobileNetV2."""
    img = Image.open(path).convert('RGB').resize((IMG_SIZE, IMG_SIZE))
    arr = np.array(img, dtype=np.float32)
    # MobileNetV2 preprocessing: scale to [-1, 1]
    arr = arr / 127.5 - 1.0
    return arr

def build_dataset(classes):
    """Build training arrays from downloaded images."""
    labels_map = sorted(classes.keys())
    label_names = [classes[pid]['name'] for pid in labels_map]

    X = []
    y = []

    for idx, pid in enumerate(labels_map):
        for img_path in classes[pid]['images']:
            try:
                arr = load_and_preprocess(img_path)
                X.append(arr)
                y.append(idx)
            except Exception as e:
                print(f"  Error loading {img_path}: {e}")

    X = np.array(X)
    y = tf.keras.utils.to_categorical(y, num_classes=len(labels_map))

    return X, y, label_names

# ============================================================
# Train Model
# ============================================================
def train_model(X, y, num_classes):
    """Train MobileNetV2 with transfer learning."""
    print(f"\nTraining on {len(X)} images, {num_classes} classes...")

    # Load MobileNetV2 as feature extractor
    base_model = tf.keras.applications.MobileNetV2(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        weights='imagenet'
    )
    base_model.trainable = False  # Freeze base layers

    # Add classification head
    model = tf.keras.Sequential([
        base_model,
        tf.keras.layers.GlobalAveragePooling2D(),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(num_classes, activation='softmax')
    ])

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )

    model.summary()

    # Data augmentation
    augmentation = tf.keras.Sequential([
        tf.keras.layers.RandomFlip("horizontal"),
        tf.keras.layers.RandomRotation(0.15),
        tf.keras.layers.RandomZoom(0.1),
        tf.keras.layers.RandomBrightness(0.2),
        tf.keras.layers.RandomContrast(0.2),
    ])

    # Augment training data
    X_aug = np.concatenate([X, np.array([augmentation(img).numpy() for img in X])])
    y_aug = np.concatenate([y, y])

    # Shuffle
    indices = np.random.permutation(len(X_aug))
    X_aug = X_aug[indices]
    y_aug = y_aug[indices]

    # Train
    history = model.fit(
        X_aug, y_aug,
        batch_size=BATCH_SIZE,
        epochs=EPOCHS,
        validation_split=0.2,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(patience=5, restore_best_weights=True)
        ]
    )

    final_acc = history.history['val_accuracy'][-1]
    print(f"\nFinal validation accuracy: {final_acc:.1%}")

    return model

# ============================================================
# Export to TFJS
# ============================================================
def export_model(model, label_names):
    """Export trained model to TF.js format."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"\nExporting model to {OUTPUT_DIR}...")
    tfjs.converters.save_keras_model(
        model,
        OUTPUT_DIR,
        quantization_dtype_map={'uint8': '*'}  # Quantize for smaller size
    )

    # Save labels
    labels_path = os.path.join(OUTPUT_DIR, 'labels.json')
    with open(labels_path, 'w') as f:
        json.dump(label_names, f, indent=2)

    # Report size
    total_size = sum(
        os.path.getsize(os.path.join(OUTPUT_DIR, f))
        for f in os.listdir(OUTPUT_DIR)
    )
    print(f"Model size: {total_size / 1024 / 1024:.1f} MB")
    print(f"Labels: {labels_path}")
    print(f"\nDone! Deploy the {OUTPUT_DIR}/ directory with studio/index.html")

# ============================================================
# Main
# ============================================================
def main():
    print("=== Shir Glassworks Studio — Model Training ===\n")

    init_firebase()

    tmp_dir = tempfile.mkdtemp(prefix='shir_training_')
    try:
        classes = download_training_images(tmp_dir)

        if len(classes) < 2:
            print("\nNeed at least 2 product classes with enough images to train.")
            print(f"Currently have {len(classes)} classes with >= {MIN_IMAGES_PER_CLASS} images.")
            print("Use the Studio app to capture more training photos.")
            return

        X, y, label_names = build_dataset(classes)
        model = train_model(X, y, len(label_names))
        export_model(model, label_names)

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

if __name__ == '__main__':
    main()
