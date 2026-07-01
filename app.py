import os
from backend.main import app, sio_app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    import uvicorn
    uvicorn.run(sio_app, host="0.0.0.0", port=port)
