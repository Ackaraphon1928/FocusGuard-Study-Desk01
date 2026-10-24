#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_VL53L0X.h>
#include "network.h"

DeskNetwork network("nodeA");
Adafruit_VL53L0X tof;
bool tofReady = false;
bool occupied = false;
uint32_t publishedAt = 0;
uint32_t tofRetryAt = 0;

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetPinAttenuation(FSR_PIN, ADC_11db);
  pinMode(FSR_PIN, INPUT);
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setTimeOut(100);
  tofReady = tof.begin();
  network.begin();
}

void loop() {
  network.loop();
  const uint32_t now = millis();
  if (!tofReady && now - tofRetryAt >= 10000) {
    tofRetryAt = now;
    tofReady = tof.begin();
  }
  if (now - publishedAt < PUBLISH_INTERVAL_MS) { delay(2); return; }
  publishedAt = now;
  uint32_t sum = 0;
  for (int i = 0; i < 16; ++i) sum += analogRead(FSR_PIN);
  int pressure = sum / 16;
  if (pressure >= FSR_ON_THRESHOLD) occupied = true;
  if (pressure <= FSR_OFF_THRESHOLD) occupied = false;
  JsonDocument doc;
  doc["seat_pressure"] = pressure;
  doc["seat_occupied"] = occupied;
  doc["distance_cm"] = nullptr;
  bool valid = false;
  if (tofReady) {
    VL53L0X_RangingMeasurementData_t reading;
    tof.rangingTest(&reading, false);
    valid = reading.RangeStatus == 0 && reading.RangeMilliMeter >= 30 && reading.RangeMilliMeter <= 2000;
    if (valid) doc["distance_cm"] = reading.RangeMilliMeter / 10.0;
    doc["tof_status"] = reading.RangeStatus;
    if (reading.RangeStatus == 255) tofReady = false;
  }
  doc["distance_valid"] = valid;
  network.publish("focusguard/nodeA/user", doc);
  Serial.printf("FSR=%d occupied=%d ToF valid=%d\n", pressure, occupied, valid);
}
