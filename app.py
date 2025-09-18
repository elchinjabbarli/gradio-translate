from fastapi import FastAPI
from gradio_client import Client

app = FastAPI()
client = Client("https://ae242f2f1243cb3eef.gradio.live/")

@app.get("/translate")
def translate(text: str):
    return {"translation": client.predict(text, api_name="/predict")}