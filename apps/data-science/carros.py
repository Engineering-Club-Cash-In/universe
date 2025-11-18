import pandas as pd
import numpy as np # Import numpy for NaN handling
from sklearn.model_selection import train_test_split, RandomizedSearchCV
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
# Imports for Step 6
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import lightgbm as lgb # Import LightGBM
from sklearn.feature_extraction.text import TfidfVectorizer # Keep this import
from scipy.stats import randint, uniform # For defining parameter distributions

# Add plotting libraries
import matplotlib.pyplot as plt
import seaborn as sns

# Define the path to the CSV file
csv_file_path = 'carros.csv'

# --- Helper function (Define it early) ---
def clean_feature_name(name):
    name = str(name) # Ensure it's a string
    name = name.replace('num__', '').replace('cat__', '')
    name = name.replace('_', ' ')
    # Specific cleanups
    name = name.replace('infrequent sklearn', '(Rare/Other)')
    name = name.replace('CC L.', 'CC/L.') # Keep this format
    return name.title() # Capitalize words

# --- Attempt Loading ---
df = None
used_encoding = None

# Try UTF-8 first
try:
    print("Attempting to load with UTF-8...")
    df = pd.read_csv(
        csv_file_path,
        parse_dates=['Marca temporal', 'Fecha de Revisión'], # Correct names for UTF-8
        dayfirst=True
    )
    used_encoding = 'utf-8'
    print("Successfully loaded with UTF-8.")
except UnicodeDecodeError:
    print("UTF-8 decoding failed, trying latin1...")
    try:
        df = pd.read_csv(
            csv_file_path,
            encoding='latin1',
            # Use the garbled name detected when reading as latin1
            parse_dates=['Marca temporal', 'Fecha de RevisiÃ³n'],
            dayfirst=True
        )
        used_encoding = 'latin1'
        print("Successfully loaded with latin1.")
    except Exception as e:
        print(f"Failed to load CSV with latin1 after UTF-8 failure: {e}")
        # Exit or handle error as appropriate
        exit()
except Exception as e:
    # Catch other potential errors during UTF-8 loading (like missing columns if names are different)
    print(f"An error occurred while loading the CSV with UTF-8: {e}")
    print("Trying latin1 as fallback...")
    try:
        df = pd.read_csv(
            csv_file_path,
            encoding='latin1',
            parse_dates=['Marca temporal', 'Fecha de RevisiÃ³n'],
            dayfirst=True
        )
        used_encoding = 'latin1'
        print("Successfully loaded with latin1.")
    except Exception as e_latin:
         print(f"Failed to load CSV with latin1 after UTF-8 error: {e_latin}")
         exit()


# --- Clean Column Names if Latin1 was used ---
if used_encoding == 'latin1':
    print("\nCleaning column names from latin1 Mojibake...")
    try:
        df.columns = [col.encode('latin1').decode('utf-8') for col in df.columns]
        print("Column names cleaned.")
        # Re-check date parsing for the now correctly named column
        if 'Fecha de Revisión' in df.columns and not pd.api.types.is_datetime64_any_dtype(df['Fecha de Revisión']):
             print("Re-parsing 'Fecha de Revisión' after column name cleaning...")
             df['Fecha de Revisión'] = pd.to_datetime(df['Fecha de Revisión'], dayfirst=True, errors='coerce')
    except Exception as e:
        print(f"Error cleaning column names: {e}")
        # Proceeding with potentially garbled names


# --- Verification ---
if df is not None:
    # Drop completely empty columns
    print("\nDropping empty columns...")
    df.drop(columns=['Unnamed: 33', 'Marca [Fila 2]', 'Marca [Fila 3]'], inplace=True, errors='ignore')

    # --- Target Variable Definition & Cleaning ---
    target_col_name = 'Valor comercial sugerido'
    print(f"\nCleaning target variable: {target_col_name}")
    if target_col_name not in df.columns:
        print(f"Error: Target column '{target_col_name}' not found!")
        exit()
    # Clean currency format
    df[target_col_name] = df[target_col_name].astype(str).str.replace('Q', '', regex=False).str.strip()
    df[target_col_name] = df[target_col_name].str.replace('.', '', regex=False)
    df[target_col_name] = df[target_col_name].str.replace(',', '.', regex=False)
    df[target_col_name] = pd.to_numeric(df[target_col_name], errors='coerce')
    # Drop rows with missing target
    initial_rows = len(df)
    df.dropna(subset=[target_col_name], inplace=True)
    print(f"Dropped {initial_rows - len(df)} rows with missing target.")

    # --- Feature Selection ---
    print("\nSelecting features based on 'basic quantitative/structured' info...")
    # Define features EXPECTED in the raw data for initial selection
    initial_numerical_features = ['Año', 'Cilindros', 'Motor CC/L.']
    categorical_features = ['Marca', 'Línea', 'Procedencia', 'Tipo', 'Combustible', 'Transmisión']
    interim_features = ['Millas', 'Kilómetros'] # Needed to calculate Distance_km
    # Combine expected raw features
    required_raw_cols = initial_numerical_features + categorical_features + interim_features
    selected_cols = list(set(required_raw_cols + [target_col_name])) # Use set to avoid duplicates

    # Ensure all selected raw columns exist
    selected_cols = [col for col in selected_cols if col in df.columns]
    missing_required = [col for col in required_raw_cols if col not in df.columns]
    if missing_required:
        print(f"Error: Required feature columns missing from data: {missing_required}")
        exit()

    df_processed = df[selected_cols].copy()
    print(f"Selected columns for processing: {df_processed.columns.tolist()}")

    # --- Combined Preprocessing (Steps from 3 & 5a) ---
    print("\nStarting Combined Preprocessing...")

    # 1. Handle Missing Values BEFORE calculations/transformations
    print("  Handling missing values...")
    # Impute interim distance features before calculation
    df_processed['Millas'] = pd.to_numeric(df_processed['Millas'], errors='coerce').fillna(0)
    df_processed['Kilómetros'] = pd.to_numeric(df_processed['Kilómetros'], errors='coerce').fillna(0)
    # Impute other numerical features with median
    for col in initial_numerical_features: # Use initial list here
        if col in df_processed.columns:
            df_processed[col] = pd.to_numeric(df_processed[col], errors='coerce')
            median_val = df_processed[col].median()
            df_processed[col].fillna(median_val, inplace=True)
            print(f"    - Imputed NaNs in '{col}' with median {median_val}")
    # Impute categorical features with 'Unknown'
    for col in categorical_features:
        if col in df_processed.columns:
            df_processed[col].fillna('Unknown', inplace=True)
            print(f"    - Imputed NaNs in '{col}' with 'Unknown'")


    # 2. Calculate Distance_km
    print("  Calculating 'Distance_km'...")
    miles_to_km = 1.60934
    df_processed['Distance_km'] = np.where(
        (df_processed['Kilómetros'] > 0) & (df_processed['Millas'] <= 0),
        df_processed['Kilómetros'],
        np.where(
            df_processed['Millas'] > 0,
            df_processed['Millas'] * miles_to_km,
            0
        )
    )
    # Drop original Millas/Kilometros columns
    df_processed.drop(columns=['Millas', 'Kilómetros'], inplace=True)
    print(f"    - Created 'Distance_km', dropped original columns.")


    # 3. Fix Data Encoding in Categorical Features
    print("  Fixing data encoding issues...")
    for col in categorical_features:
        if col in df_processed.columns:
             try:
                 if df_processed[col].apply(lambda x: isinstance(x, str)).any():
                      df_processed[col] = df_processed[col].apply(lambda x: x.encode('latin1').decode('utf-8', errors='ignore') if isinstance(x, str) else x)
             except Exception as e:
                 print(f"  - Could not fix encoding for column '{col}': {e}")


    # 4. Clean/Standardize Numerical Features
    print("  Cleaning numerical features...")
    # Año - Ensure integer
    df_processed['Año'] = df_processed['Año'].astype(int)
    # Cilindros - Cap unrealistic values
    if 'Cilindros' in df_processed.columns:
        median_cilindros = df_processed['Cilindros'].median() # Get median before modifying
        df_processed.loc[df_processed['Cilindros'] > 12, 'Cilindros'] = median_cilindros
        print("    - Capped 'Cilindros' > 12 (replaced with median).")
    # Motor CC/L. - Standardize to Liters, cap values
    if 'Motor CC/L.' in df_processed.columns:
        median_motor = df_processed['Motor CC/L.'].median() # Get median before modifying
        df_processed.loc[df_processed['Motor CC/L.'] > 100, 'Motor CC/L.'] /= 1000
        df_processed.loc[df_processed['Motor CC/L.'] > 8.0, 'Motor CC/L.'] = median_motor
        print("    - Standardized 'Motor CC/L.' to Liters, capped > 8.0L (replaced with median).")
    # Distance_km - No specific cleaning needed now, but could add outlier capping if desired

    # 5. Standardize Categorical Features
    print("  Standardizing categorical features...")
    for col in categorical_features:
         if col in df_processed.columns:
             df_processed[col] = df_processed[col].astype(str).str.upper().str.strip()
             # Apply specific replacements
             if col == 'Marca':
                 df_processed[col] = df_processed[col].replace({'MERCEDES BENZ': 'MERCEDES-BENZ', 'SSANG YOUNG': 'SSANGYONG', 'SSANG YONG': 'SSANGYONG', 'MINI COOPER': 'MINI'})
                 marca_counts = df_processed[col].value_counts()
                 rare_brands = marca_counts[marca_counts < 10].index
                 df_processed[col] = df_processed[col].replace(rare_brands, 'OTHER')
                 print(f"    - Standardized and grouped rare 'Marca'.")
             if col == 'Tipo':
                 df_processed[col] = df_processed[col].replace({'PICK UP': 'PICK-UP', 'CAMION': 'CAMIÓN', 'CAMION FURGON': 'CAMIÓN FURGON'})
                 print(f"    - Standardized 'Tipo'.")
             if col == 'Transmisión':
                 df_processed[col] = df_processed[col].replace({'AUTOMATICA': 'AUTOMÁTICO'})
                 print(f"    - Standardized 'Transmisión'.")

    print("\n--- Combined Preprocessing Complete ---")


    # --- Step 5c: Final Preparation (Encoding/Scaling - Structured Features) ---
    print("\nStarting Step 5c: Final Preparation (Structured Features)...")

    y = df_processed[target_col_name]
    # Define FINAL numerical features INCLUDING Distance_km
    numerical_features_final = ['Año', 'Cilindros', 'Motor CC/L.', 'Distance_km']
    # Define FINAL categorical features
    categorical_features_final = [col for col in categorical_features if col in df_processed.columns] # Use updated list
    X = df_processed[numerical_features_final + categorical_features_final]

    # Create preprocessing pipelines
    numeric_transformer = Pipeline(steps=[('scaler', StandardScaler())])
    categorical_transformer = Pipeline(steps=[('onehot', OneHotEncoder(handle_unknown='infrequent_if_exist', min_frequency=5, sparse_output=False))])

    # Create ColumnTransformer
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', numeric_transformer, numerical_features_final), # Use final list here
            ('cat', categorical_transformer, categorical_features_final) # Use final list here
        ],
        remainder='drop'
    )

    # Apply preprocessing
    print("\nApplying preprocessing (Scaling numerical, OneHotEncoding categorical)...")
    X_processed = preprocessor.fit_transform(X)

    # Get feature names
    try:
         feature_names_out = preprocessor.get_feature_names_out()
    except AttributeError:
         print("Warning: Using basic fallback for feature names.")
         num_feature_names = numerical_features_final
         try:
             cat_feature_names = preprocessor.named_transformers_['cat'].named_steps['onehot'].get_feature_names_out(categorical_features_final)
         except Exception:
             cat_feature_names = ["cat_feature_" + str(i) for i in range(X_processed.shape[1] - len(num_feature_names))]
         feature_names_out = list(num_feature_names) + list(cat_feature_names)

    # Convert to DataFrame
    print("\nConverting processed data to DataFrame...")
    # Check shape match BEFORE creating DataFrame
    if X_processed.shape[1] != len(feature_names_out):
        print(f"  Shape mismatch! Data has {X_processed.shape[1]} columns, but found {len(feature_names_out)} feature names.")
        # Handle error - cannot create DataFrame
        if 'X_processed_df' in locals(): del X_processed_df # Ensure it's not defined
    else:
        X_processed_df = pd.DataFrame(X_processed, columns=feature_names_out, index=X.index) # Use X.index
        print(f"  Data shape {X_processed_df.shape} matches feature names count {len(feature_names_out)}.")


    print("\n--- Verification after Final Preparation (Structured Features) ---")
    if 'X_processed_df' in locals():
        print(f"\nShape of processed features X: {X_processed_df.shape}")
        print(f"Shape of target y: {y.shape}")
        print("\nSample of processed features (X_processed_df):")
        print(X_processed_df.head())
        print("\nSample of target variable (y):")
        print(y.head())
    else:
        print("\nError: Processed DataFrame (X_processed_df) could not be created due to shape mismatch.")

    print("\n--- Final Preparation Complete ---")

    # --- Step 6: Model Building (LightGBM - Structured Features - Using Best Params) ---
    if 'X_processed_df' in locals():
        print("\nStarting Step 6: Model Building (LightGBM - Structured Features - Using Best Params)...")

        # Split data
        X_train, X_test, y_train, y_test = train_test_split(X_processed_df, y, test_size=0.2, random_state=42)
        print(f"\nSplit data into training and testing sets:")
        print(f"  X_train shape: {X_train.shape}, y_train shape: {y_train.shape}")
        print(f"  X_test shape: {X_test.shape}, y_test shape: {y_test.shape}")

        # Define the best parameters found previously
        best_params = {
            'colsample_bytree': 0.8473544037332349,
            'learning_rate': 0.04824619912671628,
            'max_depth': 8,
            'n_estimators': 230,
            'num_leaves': 19,
            'reg_alpha': 1.254335218612733,
            'reg_lambda': 0.4239958350058539,
            'random_state': 42 # Keep random state for reproducibility
        }
        print("\nUsing pre-defined best parameters:")
        print(best_params)

        # Initialize and train LightGBM model with the best parameters
        print("\nTraining LightGBM Regressor model with best params...")
        lgbm_model = lgb.LGBMRegressor(**best_params) # Use dictionary unpacking
        lgbm_model.fit(X_train, y_train)
        print("Model training complete.")

        # Make predictions using the trained model
        print("\nMaking predictions on the test set...")
        y_pred = lgbm_model.predict(X_test)

        # Evaluate the model
        print("\nEvaluating model performance on test set...")
        mae = mean_absolute_error(y_test, y_pred)
        mse = mean_squared_error(y_test, y_pred)
        rmse = np.sqrt(mse)
        r2 = r2_score(y_test, y_pred)

        print(f"  Mean Absolute Error (MAE): Q {mae:,.2f}")
        print(f"  Mean Squared Error (MSE): Q {mse:,.2f}")
        print(f"  Root Mean Squared Error (RMSE): Q {rmse:,.2f}")
        print(f"  R-squared (R²): {r2:.4f}")

        # --- Feature Importance Analysis ---
        print("\n--- Feature Importance Analysis ---")
        importances = lgbm_model.feature_importances_

        if 'feature_names_out' in locals() and isinstance(feature_names_out, (list, np.ndarray)) and len(feature_names_out) == len(importances):
            feature_importance_df = pd.DataFrame({'Feature': feature_names_out, 'Importance': importances})
            feature_importance_df = feature_importance_df.sort_values(by='Importance', ascending=False).reset_index(drop=True)

            print("\nTop Features by Importance (Final Model):")
            print(feature_importance_df.head(10))

            # --- Print Top 5 Feature Names ---
            print("\nKey Drivers of Predicted Value:")
            top_n = 5
            for i in range(min(top_n, len(feature_importance_df))): # Ensure we don't go out of bounds
                # Now this call will work because the function is defined above
                print(f"  {i+1}. {clean_feature_name(feature_importance_df.loc[i, 'Feature'])}")

            # --- Create Feature Importance Plot ---
            print("\nGenerating Feature Importance Plot...")
            plt.figure(figsize=(10, 8))
            top_features_plot = feature_importance_df.head(15)
            top_features_plot['Clean Feature'] = top_features_plot['Feature'].apply(clean_feature_name)
            sns.barplot(x='Importance', y='Clean Feature', data=top_features_plot, palette='viridis')
            plt.title('Top 15 Features Driving Predicted Car Value', fontsize=16)
            plt.xlabel('Importance Score', fontsize=12)
            plt.ylabel('Feature', fontsize=12)
            plt.tight_layout()
            plot_filename_importance = 'feature_importance_baseline.png'
            plt.savefig(plot_filename_importance)
            print(f"Feature importance plot saved as '{plot_filename_importance}'")
            plt.show()

            # --- Additional Plots for Top Features ---
            print("\nGenerating plots for top features vs. Price...")

            # Combine original preprocessed data (before scaling/OHE) with target for plotting
            plot_data = df_processed.loc[X.index].copy() # Use index from X to match y
            plot_data[target_col_name] = y

            # Scatter Plots for Top Numerical Features
            top_numerical = ['Distance_km', 'Motor CC/L.', 'Año']
            plt.figure(figsize=(15, 5))
            for i, col in enumerate(top_numerical):
                plt.subplot(1, len(top_numerical), i + 1)
                sns.scatterplot(data=plot_data, x=col, y=target_col_name, alpha=0.5)
                plt.title(f'{col} vs. {target_col_name}')
                plt.xlabel(col)
                plt.ylabel(target_col_name if i == 0 else '') # Only show y-label on first plot
                plt.ticklabel_format(style='plain', axis='y') # Avoid scientific notation
            plt.suptitle('Top Numerical Features vs. Suggested Price', fontsize=16, y=0.99)
            plt.tight_layout(rect=[0, 0.03, 1, 0.97])
            plot_filename_scatter = 'top_numerical_vs_price.png'
            plt.savefig(plot_filename_scatter)
            print(f"Scatter plots saved as '{plot_filename_scatter}'")
            plt.show()

            # Box Plots for Top Categorical Features
            # Identify top categorical features from the importance list
            top_categorical_candidates = ['Procedencia', 'Tipo'] # Add 'Marca' or others if needed
            top_categorical_plot = []
            for cat_col in top_categorical_candidates:
                # Check if any one-hot encoded versions of this column are in the top N features
                if any(f.startswith(f'cat__{cat_col}') for f in feature_importance_df.head(10)['Feature']):
                     top_categorical_plot.append(cat_col)

            if top_categorical_plot:
                plt.figure(figsize=(7 * len(top_categorical_plot), 6))
                for i, col in enumerate(top_categorical_plot):
                    plt.subplot(1, len(top_categorical_plot), i + 1)
                    # Show fewer categories if there are too many, order by median price
                    order = plot_data.groupby(col)[target_col_name].median().sort_values().index[:10] # Show top 10 by median
                    sns.boxplot(data=plot_data, x=col, y=target_col_name, order=order, palette='coolwarm', showfliers=False) # Hide outliers for clarity
                    plt.title(f'{target_col_name} Distribution by {col}')
                    plt.xlabel(col)
                    plt.ylabel(target_col_name if i == 0 else '')
                    plt.xticks(rotation=45, ha='right')
                    plt.ticklabel_format(style='plain', axis='y')
                plt.suptitle('Price Distribution by Top Categorical Features', fontsize=16, y=1.03)
                plt.tight_layout()
                plot_filename_box = 'top_categorical_vs_price.png'
                plt.savefig(plot_filename_box)
                print(f"Box plots saved as '{plot_filename_box}'")
                plt.show()
            else:
                print("No top categorical features identified for box plots based on importance.")


        else:
            print(f"Warning: Could not generate feature importance details or plots.")
            if 'feature_names_out' not in locals():
                 print("  Reason: 'feature_names_out' not found.")
            elif not isinstance(feature_names_out, (list, np.ndarray)):
                 print("  Reason: 'feature_names_out' is not a list or array.")
            elif len(feature_names_out) != len(importances):
                 print(f"  Reason: Mismatch between feature names ({len(feature_names_out)}) and importances ({len(importances)}).")


        print("\n--- Model Building and Evaluation Complete ---")

        # --- Prediction Example ---
        if 'lgbm_model' in locals() and 'preprocessor' in locals() and 'X' in locals() and 'feature_names_out' in locals():
            print("\n--- Prediction Example ---")

            # Define hypothetical car data
            hypothetical_car = pd.DataFrame({
                'Año': [2018], 'Cilindros': [4], 'Motor CC/L.': [2.0], 'Distance_km': [50000],
                'Marca': ['TOYOTA'], 'Línea': ['RAV4'], 'Procedencia': ['AGENCIA'], 'Tipo': ['CAMIONETA'],
                'Combustible': ['GASOLINA'], 'Transmisión': ['AUTOMÁTICO']
            })
            print("\nHypothetical Car Data (Raw):")
            print(hypothetical_car)
            hypothetical_car = hypothetical_car[X.columns] # Reorder

            # Apply preprocessing
            print("\nApplying preprocessing...")
            hypothetical_car_processed = preprocessor.transform(hypothetical_car)

            # Make prediction
            print("\nMaking prediction...")
            predicted_value = lgbm_model.predict(hypothetical_car_processed) # Use lgbm_model

            print(f"\nPredicted 'Valor comercial sugerido' for the hypothetical car: Q {predicted_value[0]:,.2f}")

            # --- Create Prediction Context Plot ---
            print("\nGenerating Prediction Context Plot...")
            plt.figure(figsize=(10, 6))
            sns.histplot(y_test, kde=True, color='skyblue', label='Actual Values (Test Set)', bins=30)
            plt.axvline(predicted_value[0], color='red', linestyle='--', linewidth=2, label=f'Prediction: Q {predicted_value[0]:,.0f}')
            plt.title('Prediction Context: Hypothetical Car vs Actual Test Set Values', fontsize=16)
            plt.xlabel('Valor Comercial Sugerido (Q)', fontsize=12)
            plt.ylabel('Frequency', fontsize=12)
            plt.ticklabel_format(style='plain', axis='x')
            plt.legend()
            plt.tight_layout()
            context_plot_filename = 'prediction_context.png'
            plt.savefig(context_plot_filename)
            print(f"Prediction context plot saved as '{context_plot_filename}'")
            plt.show()


        else:
            print("\nSkipping prediction example and context plot because necessary objects are missing.")

    else:
        print("\nSkipping Step 6 due to issues in Step 5c.")

else:
    print("\nDataFrame could not be loaded, skipping analysis and prediction.")
