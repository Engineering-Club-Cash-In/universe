import sqlite3
import pandas as pd
from tqdm import tqdm

# Define the file paths
txt_file = 'INE_PARQUE_VEHICULAR_080625.txt'
db_file = 'parque_vehicular.db'

# Define the table name
table_name = 'vehiculos'
chunk_size = 50000  # Process the file in chunks

# Read the text file and insert into SQLite DB in chunks
try:
    # Get total number of lines for tqdm progress bar
    total_lines = sum(1 for line in open(txt_file, 'r', encoding='latin-1')) - 1  # -1 for header

    # Create a connection to the SQLite database
    conn = sqlite3.connect(db_file)

    # Use an iterator to read the CSV in chunks
    chunk_iter = pd.read_csv(txt_file, sep='|', encoding='latin-1', chunksize=chunk_size, low_memory=False)

    # Wrap the iterator with tqdm for a progress bar
    with tqdm(total=total_lines, desc="Processing data") as pbar:
        for i, chunk in enumerate(chunk_iter):
            # Drop the last column if it's unnamed and contains NaN values
            if chunk.columns[-1].startswith('Unnamed'):
                chunk = chunk.iloc[:, :-1]
            
            # Use 'append' for subsequent chunks, 'replace' for the first one
            if_exists_param = 'replace' if i == 0 else 'append'
            
            chunk.to_sql(table_name, conn, if_exists=if_exists_param, index=False)
            pbar.update(len(chunk))

    # Close the connection
    conn.close()

    print(f'Data from {txt_file} has been successfully stored in {db_file} in table {table_name}.')

except FileNotFoundError:
    print(f'Error: The file {txt_file} was not found.')
except Exception as e:
    print(f'An error occurred: {e}')
