FROM python:3.13-alpine@sha256:42825e7ec3437b3bce923c237484eb23d32128476e18307d2f48951bf86f1db2

WORKDIR /opt/iac
COPY scripts/render-config.py /opt/iac/render-config.py
COPY central/config/vmauth.template.yaml /opt/iac/vmauth.template.yaml

ENTRYPOINT ["python", "/opt/iac/render-config.py"]
