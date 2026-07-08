# Phase 2C: Split Decision and Implementation Providers

Phase 2C keeps direct Gemini as the supervised decision brain and moves OpenHands implementation to a separately configured provider.

The implementation provider must be supplied through repository secrets and variables. Scheduled coding remains disabled. The deterministic decision, diff, validation, and result gates remain unchanged.
