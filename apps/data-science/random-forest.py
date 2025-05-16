# PRECIO PRODUCTO	SUELDO	EDAD (RANGO DE EDAD EN AÑOS)	DEPENDIENTES ECONOMICOS	OCUPACION	ANTIGUEDAD	ESTADO CIVIL	UTILIZACION DINERO	VIVIENDA PROPIA	VEHICULO PROPIO	TARJETA DE CREDITO	TIPO DE COMPRAS	Cuotas pendientes actual

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import os

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, classification_report
from sklearn.preprocessing import OneHotEncoder

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import joblib
from pydantic import BaseModel
from contextlib import asynccontextmanager

# --------------------
# Data Loading & Cleaning (and training functions)
# --------------------
def load_and_preprocess_data(file_path="big_data.csv"):
    data = pd.read_csv(file_path, delimiter=',', skipinitialspace=True)
    data.rename(columns={'EDAD (RANGO DE EDAD EN A+ANE-OS)': 'EDAD (RANGO DE EDAD EN AÑOS)'}, inplace=True)
    data.dropna(how='all', inplace=True)
    return data

def clean_currency(value):
    """Convert currency formatted strings (e.g., 'Q 66.908,00') to float."""
    try:
        value = value.replace('Q', '').strip()
        value = value.replace('.', '@')
        value = value.replace(',', '.')
        value = value.replace('@', '')
        return float(value)
    except (ValueError, AttributeError):
        return None

def train_and_save_model(data):
    # Cleaning and preprocessing
    data['PRECIO PRODUCTO'] = data['PRECIO PRODUCTO'].apply(clean_currency)
    data['SUELDO'] = data['SUELDO'].apply(clean_currency)
    data['EDAD (RANGO DE EDAD EN AÑOS)'] = data['EDAD (RANGO DE EDAD EN AÑOS)'].str.strip()
    data['ANTIGUEDAD'] = data['ANTIGUEDAD'].str.strip()
    data['ESTADO CIVIL'] = data['ESTADO CIVIL'].str.strip()
    data['DEPENDIENTES ECONOMICOS'] = pd.to_numeric(data['DEPENDIENTES ECONOMICOS'], errors='coerce')
    data['DEPENDIENTES ECONOMICOS'].fillna(data['DEPENDIENTES ECONOMICOS'].mean(), inplace=True)
    data['EDAD (RANGO DE EDAD EN AÑOS)'] = data['EDAD (RANGO DE EDAD EN AÑOS)'].map({
        '18 - 29 años': 0, '30 - 39 años': 1, '40 - 49 años': 2, '50 años o mas': 3
    })
    data['OCUPACION'] = data['OCUPACION'].map({'Dueño': 1, 'Empleado': 0})
    data['ANTIGUEDAD'] = data['ANTIGUEDAD'].map({
        '0-1 año': 0, '1-5 años': 1, '5-10 años': 2, '10 años o más': 3
    })
    data['ESTADO CIVIL'] = data['ESTADO CIVIL'].map({'Soltero': 0, 'Casado': 1})
    data['UTILIZACION DINERO'] = data['UTILIZACION DINERO'].apply(lambda x: 1 if x == 'Consumo' else 0)
    data['TIPO DE COMPRAS'] = data['TIPO DE COMPRAS'].map({'Autocompras': 0, 'Sobre Vehículos': 1})
    data['VIVIENDA PROPIA'] = data['VIVIENDA PROPIA'].apply(lambda x: 1 if x == 'Si' else 0)
    data['VEHICULO PROPIO'] = data['VEHICULO PROPIO'].apply(lambda x: 1 if x == 'Si' else 0)
    data['TARJETA DE CREDITO'] = data['TARJETA DE CREDITO'].apply(lambda x: 1 if x == 'Si' else 0)
    data['FIT'] = data['Cuotas pendientes actual'].apply(lambda x: 1 if x <= 1 else 0)
    
    data_model = data.drop(['Cuotas pendientes actual'], axis=1)
    categorical_cols = data_model.select_dtypes(include=['object']).columns
    data_model[categorical_cols] = data_model[categorical_cols].fillna('Unknown')
    numeric_cols = data_model.select_dtypes(include=[np.number]).columns
    data_model[numeric_cols] = data_model[numeric_cols].fillna(data_model[numeric_cols].mean())
    data_model = pd.get_dummies(data_model, columns=categorical_cols)
    
    X = data_model.drop('FIT', axis=1)
    y = data_model['FIT']
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    rf = RandomForestClassifier(n_estimators=100, random_state=42)
    rf.fit(X_train, y_train)
    
    # Optionally perform evaluation (plotting, printing stats, etc.) here
    # Comment out plt.show() if deploying with the API
    importances = rf.feature_importances_
    features = X.columns
    indices = np.argsort(importances)[::-1]
    
    plt.figure(figsize=(12, 6))
    plt.title("Importancia de las Características")
    plt.bar(range(len(features)), importances[indices], color="r", align="center")
    plt.xticks(range(len(features)), features[indices], rotation=45)
    plt.xlim([-1, len(features)])
    plt.tight_layout()
    # plt.show()  # Comment or remove this line when deploying the API
    
    # Example prediction for new clients (for debugging only)
    new_clients = X_test.head(5)
    predictions = rf.predict(new_clients)
    print("\nPredictions for new clients:")
    for i, pred in enumerate(predictions):
        print(f"Client {i+1}: {'Fit' if pred == 1 else 'Not Fit'}")
    
    joblib.dump(rf, 'random_forest_model.joblib')
    return rf

# --------------------
# FastAPI App & Endpoints
# --------------------
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ClientData(BaseModel):
    PRECIO_PRODUCTO: float
    SUELDO: float
    EDAD: int  # Encoded as 0-3
    DEPENDIENTES_ECONOMICOS: float
    OCUPACION: int  # 0 or 1
    ANTIGUEDAD: int  # 0-3
    ESTADO_CIVIL: int  # 0 or 1
    UTILIZACION_DINERO: int  # 0 or 1
    VIVIENDA_PROPIA: int  # 0 or 1
    VEHICULO_PROPIO: int  # 0 or 1
    TARJETA_DE_CREDITO: int  # 0 or 1
    TIPO_DE_COMPRAS: int  # 0 or 1

# Initialize model variable globally
rf = None

# Lifespan context manager to load the model on startup
@asynccontextmanager
async def lifespan(app: FastAPI):
    global rf
    print("Application startup: Loading model...")
    # Ensure the .joblib file is copied into your Docker image (or train if not found)
    model_path = 'random_forest_model.joblib'
    if os.path.exists(model_path):
        print(f"Loading existing model from {model_path}...")
        rf = joblib.load(model_path)
        print("Model loaded successfully.")
    else:
        # This part is a fallback. Ideally, you pre-train and ensure the .joblib file is present.
        print(f"Model file not found at {model_path}. Training new model...")
        print("WARNING: Training model on application startup. This can be slow.")
        data = load_and_preprocess_data() # Assumes big_data.csv is present
        rf = train_and_save_model(data)   # This will also save it as random_forest_model.joblib
        print("Model training complete and saved.")
    
    if rf is None:
        print("CRITICAL: Model could not be loaded or trained. RF is None.")
        # You might want to raise an error here to prevent the app from starting
        # or handle it in a way that /predict returns a specific error.
    else:
        print("RF model is ready.")
    
    yield # Application runs here

    # Clean up resources if needed on shutdown
    print("Application shutdown.")
    rf = None


app = FastAPI(lifespan=lifespan) # Pass the lifespan manager

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/predict")
async def predict(client: ClientData):
    global rf
    if rf is None:
        print("Error in /predict: Model (rf) is not loaded.")
        raise HTTPException(status_code=503, detail="Model not available. Please try again later.")
    try:
        input_data = [[
            client.PRECIO_PRODUCTO,
            client.SUELDO,
            client.EDAD,
            client.DEPENDIENTES_ECONOMICOS,
            client.OCUPACION,
            client.ANTIGUEDAD,
            client.ESTADO_CIVIL,
            client.UTILIZACION_DINERO,
            client.VIVIENDA_PROPIA,
            client.VEHICULO_PROPIO,
            client.TARJETA_DE_CREDITO,
            client.TIPO_DE_COMPRAS
        ]]
        prediction = rf.predict(input_data)
        probability = rf.predict_proba(input_data)
        return {
            "fit": bool(prediction[0]),
            "probability": float(probability[0][1])
        }
    except Exception as e:
        print(f"Exception during prediction: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# The if __name__ == "__main__": block is NOT needed for model loading when using lifespan
# but can be kept for running uvicorn directly for local testing if you wish.
# However, the `uvicorn.run` in it will ALSO trigger the lifespan events.
if __name__ == "__main__":
    print("Starting API server using __main__ (for local dev)...")
    import uvicorn
    # When run this way, uvicorn will also pick up the lifespan events.
    uvicorn.run(app, host="0.0.0.0", port=8000)
