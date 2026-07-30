---
title: Authentication Flow
---

# Authentication Flow

This document describes how login and session refresh work.

Users authenticate via OAuth2 with a third-party identity provider.
After login, the client receives an access token and a refresh token.
The access token expires after 15 minutes; the refresh token is used
to silently obtain a new access token without forcing the user to log
in again. Sessions are tracked server-side using a signed cookie.
