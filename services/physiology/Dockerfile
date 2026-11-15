FROM kitware/pulse:4.3.1

# Fix Debian 11 apt sources (moved to archive)
RUN echo "deb http://archive.debian.org/debian/ bullseye main" > /etc/apt/sources.list && \
    echo "deb http://archive.debian.org/debian-security bullseye-security main" >> /etc/apt/sources.list && \
    echo "Acquire::Check-Valid-Until false;" > /etc/apt/apt.conf.d/99no-check-valid-until

# Install Python dependencies needed by Pulse Python package
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install numpy pandas matplotlib

# Install application dependencies
COPY requirements.txt /app/requirements.txt
RUN pip3 install -r /app/requirements.txt

# Copy application code
COPY . /app
WORKDIR /app

# Set up environment
ENV PYTHONPATH=/pulse/python:/pulse/bin:$PYTHONPATH
ENV PULSE_DATA_ROOT=/pulse/bin

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python healthcheck.py

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
