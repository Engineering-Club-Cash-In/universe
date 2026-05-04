podman build -f Dockerfile -t legal-documents ../..

podman tag legal-documents:latest public.ecr.aws/a6w8m2u2/cci/legal-documents:latest

podman push public.ecr.aws/a6w8m2u2/cci/legal-documents:latest
