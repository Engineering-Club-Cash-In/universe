podman build --build-arg CARTERA_LOG_ENVIRONMENT=development -f Dockerfile -t cartera-back-dev ../..

podman tag cartera-back-dev:latest public.ecr.aws/a6w8m2u2/cartera-back-dev:latest

podman push public.ecr.aws/a6w8m2u2/cartera-back-dev:latest
