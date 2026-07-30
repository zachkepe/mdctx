# Deployment

This project deploys via a container image built in CI and pushed to
a registry. The production environment pulls the latest tagged image
on release. Environment variables are injected at deploy time through
the platform's secret manager, not baked into the image.
