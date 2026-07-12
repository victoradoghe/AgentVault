# server/

The core service layer for Agent Memory Cloud.

This is where server-only logic lives — database access, the memory
service, auth, and API handlers. Nothing here should be imported into
client components. Feature modules will be added in later phases.
