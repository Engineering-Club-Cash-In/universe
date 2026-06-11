podman build \
  --build-arg VITE_BACK_URL=https://js4cock4o0k04g4cogckw0cc.s2.devteamatcci.site \
  -t cartera-front-dev .

podman tag cartera-front-dev:latest public.ecr.aws/a6w8m2u2/cartera-front-dev:latest

podman push public.ecr.aws/a6w8m2u2/cartera-front-dev:latest
