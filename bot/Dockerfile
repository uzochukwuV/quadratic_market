FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app
ENV IDL_PATH=/app/target/idl/quadratic_market.json

COPY bot/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY bot /app
COPY target/idl/quadratic_market.json /app/target/idl/quadratic_market.json

RUN chmod +x /app/entrypoint.sh

EXPOSE 8787

ENTRYPOINT ["/app/entrypoint.sh"]
