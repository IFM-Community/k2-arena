#!/bin/bash
cd /app && python -m uvicorn app:sio_app --host 0.0.0.0 --port $PORT