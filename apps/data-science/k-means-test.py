import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import silhouette_score

# Load the data
file_path = "data.csv"  # Replace with your file path
data = pd.read_csv(file_path)

# Remove completely empty rows
data.dropna(how='all', inplace=True)

# Cleaning currency and categorical values
def clean_currency(value):
    """Convert currency formatted strings (Q xx.xxx,xx) to float."""
    try:
        # Remove 'Q' and spaces
        value = value.replace('Q', '').strip()
        # Replace points with temporary character
        value = value.replace('.', '@')
        # Replace comma with point
        value = value.replace(',', '.')
        # Replace temporary character with empty string (was thousand separator)
        value = value.replace('@', '')
        return float(value)
    except (ValueError, AttributeError):
        return None

data['PRECIO PRODUCTO'] = data['PRECIO PRODUCTO'].apply(clean_currency)
data['SUELDO'] = data['SUELDO'].apply(clean_currency)

# Strip leading and trailing spaces from categorical columns
data['EDAD (RANGO DE EDAD EN AÑOS)'] = data['EDAD (RANGO DE EDAD EN AÑOS)'].str.strip()
data['ANTIGÜEDAD'] = data['ANTIGÜEDAD'].str.strip()
data['ESTADO CIVIL'] = data['ESTADO CIVIL'].str.strip()


# Map categorical features for encoding
data['EDAD (RANGO DE EDAD EN AÑOS)'] = data['EDAD (RANGO DE EDAD EN AÑOS)'].map({
    '18 - 29 años': 0, '30 - 39 años': 1, '40 - 49 años': 2, '50 años o mas': 3
})
data['OCUPACIÓN'] = data['OCUPACIÓN'].map({'Dueño': 1, 'Empleado': 0})
data['ANTIGÜEDAD'] = data['ANTIGÜEDAD'].map({
    '0-1 año': 0, '1-5 años': 1, '5-10 años': 2, '10 años o más': 3
})
data['ESTADO CIVIL'] = data['ESTADO CIVIL'].map({'Soltero': 0, 'Casado': 1, 'Divorciado': 2})
data['UTILIZACION DINERO'] = data['UTILIZACION DINERO'].apply(lambda x: 1 if x == 'Consumo' else 0)
data['VIVIENDA PROPIA'] = data['VIVIENDA PROPIA'].apply(lambda x: 1 if x == 'Si' else 0)
data['VEHICULO PROPIO'] = data['VEHICULO PROPIO'].apply(lambda x: 1 if x == 'Si' else 0)
data['TARJETA DE CREDITO'] = data['TARJETA DE CREDITO'].apply(lambda x: 1 if x == 'Si' else 0)
data['TIPO DE COMPRAS'] = data['TIPO DE COMPRAS'].map({'Autocompras': 0, 'Sobre Vehículos': 1})

# Drop client name and handle missing values
data_clean = data.drop(['CLIENTE'], axis=1)

# Fill missing values in categorical columns with a placeholder or mode
categorical_cols = data_clean.select_dtypes(include=['object']).columns
data_clean[categorical_cols] = data_clean[categorical_cols].fillna('Unknown')

# Fill missing values only in numeric columns
numeric_cols = data_clean.select_dtypes(include=[np.number]).columns
data_clean[numeric_cols] = data_clean[numeric_cols].fillna(data_clean[numeric_cols].mean())

# Check for NaN values and print details
nan_columns = data_clean.columns[data_clean.isnull().any()].tolist()
if nan_columns:
    print(f"Columns with NaN values: {nan_columns}")
    print("Rows with NaN values:")
    print(data_clean[data_clean.isnull().any(axis=1)])
    raise ValueError("There are still NaN values in the data_clean DataFrame.")

# Scaling the features
scaler = StandardScaler()
X_scaled = scaler.fit_transform(data_clean)

# Verify no NaN values exist after scaling
if np.isnan(X_scaled).any():
    raise ValueError("NaN values found in X_scaled after scaling.")

# Train K-Means with 4 clusters instead of 3
kmeans = KMeans(n_clusters=4, random_state=42)
data_clean['CLUSTER'] = kmeans.fit_predict(X_scaled)

# Example new client data
nuevo_cliente = {
    'PRECIO PRODUCTO': 150000,
    'SUELDO': 20000,
    'EDAD (RANGO DE EDAD EN AÑOS)': 0,
    'DEPENDIENTES ECONOMICOS': 0,
    'OCUPACIÓN': 0,
    'ANTIGÜEDAD': 0,
    'ESTADO CIVIL': 0,
    'UTILIZACION DINERO': 1,
    'VIVIENDA PROPIA': 1,
    'VEHICULO PROPIO': 1,
    'TARJETA DE CREDITO': 1,
    'TIPO DE COMPRAS': 0
}

# Convert the dictionary to DataFrame
nuevo_cliente_df = pd.DataFrame([nuevo_cliente])

# Scale the new client
nuevo_cliente_scaled = scaler.transform(nuevo_cliente_df)

# Predict the cluster for the new client
cluster_asignado = kmeans.predict(nuevo_cliente_scaled)
print(f"El nuevo cliente pertenece al clúster: {cluster_asignado[0]}")

# Find similar clients
clientes_similares = data_clean[data_clean['CLUSTER'] == cluster_asignado[0]]

# Calculate the average price in the cluster
precio_promedio = clientes_similares['PRECIO PRODUCTO'].mean()
print(f"El precio promedio para clientes similares es: {precio_promedio} Quetzales")

# Compare the new client's price with the cluster's average
diferencia_precio = abs(nuevo_cliente['PRECIO PRODUCTO'] - precio_promedio)
print(f"La diferencia con el precio promedio es de: {diferencia_precio} Quetzales")

# Calculate average values for each cluster
cluster_means = data_clean.groupby('CLUSTER').mean()
print("\nCaracterísticas promedio por cluster:")
print(cluster_means)

# Plotting clusters with new client visualization
plt.figure(figsize=(12, 8))

# Create scatter plot
scatter = plt.scatter(X_scaled[:, 0], X_scaled[:, 1], 
                     c=data_clean['CLUSTER'], 
                     cmap='viridis',
                     label='Clientes existentes')

# Add new client
plt.scatter(nuevo_cliente_scaled[:, 0], nuevo_cliente_scaled[:, 1], 
           color='red', marker='X', s=200, 
           label='Nuevo Cliente')

# Add title and labels
plt.title('Segmentación de Clientes por Precio y Sueldo')
plt.xlabel('Precio Producto (normalizado)')
plt.ylabel('Sueldo (normalizado)')

# Add colorbar
colorbar = plt.colorbar(scatter)
colorbar.set_label('Número de Cluster')

# Add legend
plt.legend()
plt.show()

# Print detailed cluster analysis
print("\nAnálisis Detallado de Clusters:")
for cluster in range(4):
    cluster_data = data_clean[data_clean['CLUSTER'] == cluster]
    print(f"\nCluster {cluster}:")
    print(f"Número de clientes: {len(cluster_data)}")
    print("\nEstadísticas de Precio:")
    print(f"Mínimo: Q{cluster_data['PRECIO PRODUCTO'].min():,.2f}")
    print(f"Máximo: Q{cluster_data['PRECIO PRODUCTO'].max():,.2f}")
    print(f"Promedio: Q{cluster_data['PRECIO PRODUCTO'].mean():,.2f}")
    print(f"Mediana: Q{cluster_data['PRECIO PRODUCTO'].median():,.2f}")
    
    print("\nEstadísticas de Sueldo:")
    print(f"Mínimo: Q{cluster_data['SUELDO'].min():,.2f}")
    print(f"Máximo: Q{cluster_data['SUELDO'].max():,.2f}")
    print(f"Promedio: Q{cluster_data['SUELDO'].mean():,.2f}")
    print(f"Mediana: Q{cluster_data['SUELDO'].median():,.2f}")
    
    print("\nCaracterísticas adicionales:")
    print(f"Promedio de dependientes: {cluster_data['DEPENDIENTES ECONOMICOS'].mean():.2f}")
    print(f"% con vivienda propia: {(cluster_data['VIVIENDA PROPIA'].mean()*100):.1f}%")
    print(f"% con vehículo propio: {(cluster_data['VEHICULO PROPIO'].mean()*100):.1f}%")
    print(f"% con tarjeta de crédito: {(cluster_data['TARJETA DE CREDITO'].mean()*100):.1f}%")
    
    # Mostrar distribución de tipos de compra
    compras = cluster_data['TIPO DE COMPRAS'].value_counts(normalize=True) * 100
    print("\nDistribución de tipos de compra:")
    for tipo, porcentaje in compras.items():
        tipo_nombre = 'Autocompras' if tipo == 0 else 'Sobre Vehículos'
        print(f"{tipo_nombre}: {porcentaje:.1f}%")

# Calculate silhouette score
silhouette_avg = silhouette_score(X_scaled, kmeans.labels_)
print(f"\nPuntuación de Silueta: {silhouette_avg:.3f}")

# Elbow Method
inertias = []
K = range(1, 10)

for k in K:
    kmeans = KMeans(n_clusters=k, random_state=42)
    kmeans.fit(X_scaled)
    inertias.append(kmeans.inertia_)

# Plot Elbow curve
plt.figure(figsize=(10, 6))
plt.plot(K, inertias, 'bx-')
plt.xlabel('k')
plt.ylabel('Inertia')
plt.title('Elbow Method For Optimal k')
plt.show()

# Silhouette Analysis
silhouette_scores = []
K = range(2, 10)

for k in K:
    kmeans = KMeans(n_clusters=k, random_state=42)
    kmeans.fit(X_scaled)
    score = silhouette_score(X_scaled, kmeans.labels_)
    silhouette_scores.append(score)

# Plot Silhouette scores
plt.figure(figsize=(10, 6))
plt.plot(K, silhouette_scores, 'bx-')
plt.xlabel('k')
plt.ylabel('Silhouette Score')
plt.title('Silhouette Score vs k')
plt.show()

# Print detailed statistics for each cluster
print("\nEstadísticas detalladas por cluster:")
for cluster in range(len(cluster_means)):
    print(f"\nCluster {cluster}:")
    print("Estadísticas de precio:")
    cluster_data = data_clean[data_clean['CLUSTER'] == cluster]
    print(f"Mínimo: Q{cluster_data['PRECIO PRODUCTO'].min():,.2f}")
    print(f"Máximo: Q{cluster_data['PRECIO PRODUCTO'].max():,.2f}")
    print(f"Promedio: Q{cluster_data['PRECIO PRODUCTO'].mean():,.2f}")
    print(f"Mediana: Q{cluster_data['PRECIO PRODUCTO'].median():,.2f}")
    print(f"Número de clientes: {len(cluster_data)}")
