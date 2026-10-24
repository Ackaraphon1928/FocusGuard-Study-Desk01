#pragma once

// Copy this file to esp32/shared/config.h; keep credentials out of version control.
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define MQTT_HOST "192.168.1.10"
#define MQTT_PORT 1883
#define MQTT_USERNAME ""
#define MQTT_PASSWORD ""
#define NTP_SERVER "pool.ntp.org"

// ESP32 DevKit / esp32dev: ADC1 remains available while Wi-Fi is enabled.
#define I2C_SDA 21
#define I2C_SCL 22
#define FSR_PIN 34
#define PIR_PIN 27
#define SOUND_PIN 35
// Calibrate with your own FSR divider, empty chair and seated user.
#define FSR_ON_THRESHOLD 900
#define FSR_OFF_THRESHOLD 650
// Relative RMS amplitude scale. Not calibrated decibels; adjust to your module.
#define SOUND_RMS_FULL_SCALE 450.0f
#define SOUND_QUIET_THRESHOLD 0.30f
#define SOUND_NOISY_THRESHOLD 0.65f
#define PUBLISH_INTERVAL_MS 1000
