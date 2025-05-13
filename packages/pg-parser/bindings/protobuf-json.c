#define _POSIX_C_SOURCE 200809L

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "macros.h"
#include "pg_query.h"
#include "protobuf/pg_query.pb-c.h"
#include "protobuf2json.h"

typedef struct {
  char *json_string;
  char *error;
} ProtobufToJsonResult;

typedef struct {
  PgQueryProtobuf protobuf;
  char *error;
} JsonToProtobufResult;

EXPORT("protobuf_to_json")
ProtobufToJsonResult *protobuf_to_json(PgQueryProtobuf *protobuf) {
  ProtobufToJsonResult *result = (ProtobufToJsonResult *)malloc(sizeof(ProtobufToJsonResult));

  // Unpack the protobuf binary data back into a message
  PgQuery__ParseResult *parse_result = pg_query__parse_result__unpack(NULL, protobuf->len, (uint8_t *)protobuf->data);
  if (!parse_result) {
    result->error = strdup("Failed to unpack protobuf message");
    return result;
  }
  printf("size of protobuf: %zu\n", pg_query__parse_result__get_packed_size(parse_result));

  char *error = (char *)malloc(sizeof(char) * 256);

  // Convert the protobuf message to a JSON string
  int ret = protobuf2json_string(
      &parse_result->base,
      0,
      &result->json_string,
      error,
      256);

  free(parse_result);

  if (ret != 0) {
    result->error = error;
    return result;
  }

  free(error);
  return result;
}

EXPORT("json_to_protobuf")
JsonToProtobufResult *json_to_protobuf(char *json_string) {
  JsonToProtobufResult *result = (JsonToProtobufResult *)malloc(sizeof(JsonToProtobufResult));
  ProtobufCMessage *protobuf_message = NULL;

  char *error = (char *)malloc(sizeof(char) * 256);

  printf("json_string: %s\n", json_string);

  // Convert the JSON string to a protobuf message
  int ret = json2protobuf_string(
      json_string,
      0,
      &pg_query__parse_result__descriptor,
      &protobuf_message,
      error,
      256);

  if (ret != 0) {
    result->error = error;
    return result;
  }

  free(error);

  PgQuery__ParseResult *parse_result = (PgQuery__ParseResult *)protobuf_message;

  printf("size of protobuf: %zu\n", pg_query__parse_result__get_packed_size(parse_result));

  char *error2 = (char *)malloc(sizeof(char) * 256);
  char *json_string_reparsed = NULL;

  // Convert the protobuf message to a JSON string
  protobuf2json_string(
      &parse_result->base,
      0,
      &json_string_reparsed,
      error2,
      256);

  printf("json_string after reparse: %s\n", json_string_reparsed);

  result->protobuf.len = pg_query__parse_result__get_packed_size(parse_result);
  result->protobuf.data = malloc(sizeof(char) * result->protobuf.len);
  // result->protobuf.len = protobuf_c_message_get_packed_size(protobuf_message);
  // result->protobuf.data = malloc(sizeof(char) * result->protobuf.len);

  // Pack the protobuf message into binary data
  pg_query__parse_result__pack(parse_result, (uint8_t *)result->protobuf.data);
  // protobuf_c_message_pack(protobuf_message, (uint8_t *)result->protobuf.data);

  printf("pointer of result: %p\n", result);
  printf("pointer of result->protobuf: %p\n", &result->protobuf);
  printf("result->protobuf.len: %d\n", result->protobuf.len);

  // Free the protobuf message since we've packed it
  // protobuf_c_message_free_unpacked((ProtobufCMessage *)protobuf_message, NULL);

  return result;
}

EXPORT("free_protobuf_to_json_result")
void free_protobuf_to_json_result(ProtobufToJsonResult *result) {
  if (result->json_string) {
    free(result->json_string);
  }
  if (result->error) {
    free(result->error);
  }
  free(result);
}

EXPORT("free_json_to_protobuf_result")
void free_json_to_protobuf_result(JsonToProtobufResult *result) {
  if (result->protobuf.data) {
    free(result->protobuf.data);
  }
  if (result->error) {
    free(result->error);
  }
  free(result);
}