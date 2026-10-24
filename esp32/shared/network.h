#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "config.h"

class DeskNetwork {
  WiFiClient socket;
  PubSubClient mqtt;
  const char *device;
  uint32_t lastWifiAttempt = 0;
  uint32_t lastBrokerAttempt = 0;
  uint32_t retryMs = 1000;
public:
  explicit DeskNetwork(const char *name) : mqtt(socket), device(name) {}
  void begin() {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    configTime(0, 0, NTP_SERVER);
    mqtt.setServer(MQTT_HOST, MQTT_PORT);
    mqtt.setBufferSize(1024);
    mqtt.setSocketTimeout(2);
    mqtt.setKeepAlive(20);
  }
  void loop() {
    const uint32_t now = millis();
    if (WiFi.status() != WL_CONNECTED) {
      if (now - lastWifiAttempt >= 10000) {
        lastWifiAttempt = now;
        WiFi.reconnect();
      }
      return;
    }
    if (!mqtt.connected() && now - lastBrokerAttempt >= retryMs) {
      lastBrokerAttempt = now;
      String statusTopic = String("focusguard/") + device + "/status";
      String clientId = String("fg-") + device + "-" + WiFi.macAddress();
      bool ok = mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD,
                             statusTopic.c_str(), 1, true, "offline");
      if (ok) {
        retryMs = 1000;
        mqtt.publish(statusTopic.c_str(), "online", true);
      } else {
        retryMs = min(retryMs * 2, (uint32_t)30000);
      }
    }
    mqtt.loop();
  }
  bool publish(const char *topic, JsonDocument &doc) {
    // NTP unavailable is explicit; backend uses receive time when timestamp is null.
    time_t now = time(nullptr);
    if (now > 1700000000) {
      struct tm utc;
      gmtime_r(&now, &utc);
      char timestamp[25];
      strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
      doc["timestamp"] = timestamp;
    } else {
      doc["timestamp"] = nullptr;
    }
    doc["device_id"] = device;
    doc["uptime_ms"] = millis();
    doc["rssi_dbm"] = WiFi.RSSI();
    char payload[1024];
    size_t count = serializeJson(doc, payload, sizeof(payload));
    return count < sizeof(payload) && mqtt.connected() && mqtt.publish(topic, payload, false);
  }
};
