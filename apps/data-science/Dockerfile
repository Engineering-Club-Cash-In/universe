FROM python:3.11-slim

WORKDIR /app

COPY big_data.csv .
COPY requirements.txt .

RUN pip install -r requirements.txt

COPY random-forest.py .
COPY random_forest_model.joblib .

EXPOSE 8000

CMD ["uvicorn", "random-forest:app", "--host", "0.0.0.0", "--port", "8000"]