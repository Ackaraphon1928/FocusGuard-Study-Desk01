#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <math.h>
#include "network.h"

DeskNetwork network("nodeB");
uint32_t sampleAt = 0;
uint32_t publishedAt = 0;
uint32_t count = 0;
double sum = 0;
double squares = 0;
bool motionDuringWindow = false;

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetPinAttenuation(SOUND_PIN, ADC_11db);
  pinMode(SOUND_PIN, INPUT);
  pinMode(PIR_PIN, INPUT);
  network.begin();
}

void loop() {
  network.loop();
  uint32_t nowMicros = micros();
  // Only accumulators are retained. No audio samples, clips or speech leave the board.
  if (nowMicros - sampleAt >= 500) {
    sampleAt = nowMicros;
    double value = analogRead(SOUND_PIN);
    sum += value;
    squares += value * value;
    ++count;
    motionDuringWindow |= digitalRead(PIR_PIN) == HIGH;
  }
  uint32_t now = millis();
  if (now - publishedAt < PUBLISH_INTERVAL_MS) return;
  publishedAt = now;
  if (!count) return;
  double mean = sum / count;
  double rms = sqrt(max(0.0, squares / count - mean * mean));
  float level = constrain(rms / SOUND_RMS_FULL_SCALE, 0.0, 1.0);
  JsonDocument doc;
  // HC-SR501 needs a startup settling period; do not report it as real presence.
  doc["motion"] = now >= 60000 && motionDuringWindow;
  doc["pir_warming_up"] = now < 60000;
  doc["noise_level"] = level;
  doc["noise_state"] = level >= SOUND_NOISY_THRESHOLD ? "NOISY" : (level >= SOUND_QUIET_THRESHOLD ? "MODERATE" : "QUIET");
  doc["sample_count"] = count;
  network.publish("focusguard/nodeB/environment", doc);
  Serial.printf("motion=%d relative_noise=%.3f samples=%lu\n", motionDuringWindow, level, (unsigned long)count);
  count = 0; sum = 0; squares = 0; motionDuringWindow = false;
}
