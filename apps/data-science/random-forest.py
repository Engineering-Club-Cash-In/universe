# PRECIO PRODUCTO	SUELDO	EDAD (RANGO DE EDAD EN AÑOS)	DEPENDIENTES ECONOMICOS	OCUPACION	ANTIGUEDAD	ESTADO CIVIL	UTILIZACION DINERO	VIVIENDA PROPIA	VEHICULO PROPIO	TARJETA DE CREDITO	TIPO DE COMPRAS	Cuotas pendientes actual

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, classification_report
from sklearn.preprocessing import OneHotEncoder

# --------------------
# Data Loading & Cleaning
# --------------------

file_path = "big_data.csv"  # Replace with your file path
data = pd.read_csv(file_path, delimiter=',', skipinitialspace=True)

# Rename the column with the typo
data.rename(columns={'EDAD (RANGO DE EDAD EN A+ANE-OS)': 'EDAD (RANGO DE EDAD EN AÑOS)'}, inplace=True)

# Remove completely empty rows
data.dropna(how='all', inplace=True)

# Cleaning currency formatted columns
def clean_currency(value):
    """Convert currency formatted strings (e.g., 'Q 66.908,00') to float."""
    try:
        # Remove 'Q' and leading/trailing spaces
        value = value.replace('Q', '').strip()
        # Temporarily replace thousand separators (points) with a marker
        value = value.replace('.', '@')
        # Replace decimal separator (comma) with a point
        value = value.replace(',', '.')
        # Remove the marker (thousand separator)
        value = value.replace('@', '')
        return float(value)
    except (ValueError, AttributeError):
        return None

data['PRECIO PRODUCTO'] = data['PRECIO PRODUCTO'].apply(clean_currency)
data['SUELDO'] = data['SUELDO'].apply(clean_currency)

# Strip leading & trailing spaces from textual/categorical columns
data['EDAD (RANGO DE EDAD EN AÑOS)'] = data['EDAD (RANGO DE EDAD EN AÑOS)'].str.strip()
data['ANTIGUEDAD'] = data['ANTIGUEDAD'].str.strip()
data['ESTADO CIVIL'] = data['ESTADO CIVIL'].str.strip()

# Ensure 'DEPENDIENTES ECONOMICOS' is numeric
data['DEPENDIENTES ECONOMICOS'] = pd.to_numeric(data['DEPENDIENTES ECONOMICOS'], errors='coerce')

# Fill missing values in 'DEPENDIENTES ECONOMICOS' with the mean or a specific value
data['DEPENDIENTES ECONOMICOS'].fillna(data['DEPENDIENTES ECONOMICOS'].mean(), inplace=True)

# --------------------
# Mapping Categorical Variables
# --------------------

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

# Convert yes/no columns to binary (1 for 'Si', 0 otherwise)
data['VIVIENDA PROPIA'] = data['VIVIENDA PROPIA'].apply(lambda x: 1 if x == 'Si' else 0)
data['VEHICULO PROPIO'] = data['VEHICULO PROPIO'].apply(lambda x: 1 if x == 'Si' else 0)
data['TARJETA DE CREDITO'] = data['TARJETA DE CREDITO'].apply(lambda x: 1 if x == 'Si' else 0)

# --------------------
# Target Variable: Define "FIT"
# --------------------
# A candidate is considered "fit" (1) if they have 0 cuotas pendientes actual,
# and not fit (0) if they have 1 or more pending cuotas.
data['FIT'] = data['Cuotas pendientes actual'].apply(lambda x: 1 if x <= 1 else 0)

# --------------------
# Prepare Data for Modeling
# --------------------
# Drop columns that are not features
data_model = data.drop(['Cuotas pendientes actual'], axis=1)

# Ensure no missing values remain by filling if necessary
categorical_cols = data_model.select_dtypes(include=['object']).columns
data_model[categorical_cols] = data_model[categorical_cols].fillna('Unknown')
numeric_cols = data_model.select_dtypes(include=[np.number]).columns
data_model[numeric_cols] = data_model[numeric_cols].fillna(data_model[numeric_cols].mean())

# One-hot encode any remaining categorical variables
data_model = pd.get_dummies(data_model, columns=categorical_cols)

# Separate features (X) and target (y)
X = data_model.drop('FIT', axis=1)
y = data_model['FIT']

# --------------------
# Train-Test Split
# --------------------
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# --------------------
# Random Forest Classifier
# --------------------
rf = RandomForestClassifier(n_estimators=100, random_state=42)
rf.fit(X_train, y_train)

# Predict on test set
y_pred = rf.predict(X_test)

# --------------------
# Evaluation
# --------------------
print("Accuracy:", accuracy_score(y_test, y_pred))
print("\nConfusion Matrix:")
print(confusion_matrix(y_test, y_pred))
print("\nClassification Report:")
print(classification_report(y_test, y_pred))

# --------------------
# Feature Importances
# --------------------
importances = rf.feature_importances_
features = X.columns
indices = np.argsort(importances)[::-1]

plt.figure(figsize=(12, 6))
plt.title("Importancia de las Características")
plt.bar(range(len(features)), importances[indices], color="r", align="center")
plt.xticks(range(len(features)), features[indices], rotation=45)
plt.xlim([-1, len(features)])
plt.tight_layout()
plt.show()

# --------------------
# Predicting New Clients
# --------------------
# Example: Predict the "fit" status for the first 5 clients in the test set
new_clients = X_test.head(5)
predictions = rf.predict(new_clients)

print("\nPredictions for new clients:")
for i, pred in enumerate(predictions):
    print(f"Client {i+1}: {'Fit' if pred == 1 else 'Not Fit'}")
