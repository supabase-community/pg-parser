#include "protobuf-json.h"

#define _POSIX_C_SOURCE 200809L

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "macros.h"
#include "pg_query.h"
#include "protobuf/pg_query.pb-c.h"
#include "protobuf2json.h"

ProtobufToJsonResult *protobuf_to_json(PgQueryProtobuf *protobuf) {
  ProtobufToJsonResult *result = (ProtobufToJsonResult *)calloc(1, sizeof(ProtobufToJsonResult));

  PgQuery__ParseResult *parse_result = pg_query__parse_result__unpack(NULL, protobuf->len, (uint8_t *)protobuf->data);
  if (!parse_result) {
    result->error = strdup("Failed to unpack protobuf message");
    return result;
  }

  char *error = (char *)malloc(sizeof(char) * 256);

  int ret = protobuf2json_string(
      &parse_result->base,
      0,
      &result->json_string,
      error,
      256);

  protobuf_c_message_free_unpacked(&parse_result->base, NULL);

  if (ret != 0) {
    result->error = error;
    return result;
  }

  free(error);
  return result;
}

JsonToProtobufResult *json_to_protobuf(char *json_string) {
  JsonToProtobufResult *result = (JsonToProtobufResult *)calloc(1, sizeof(JsonToProtobufResult));
  ProtobufCMessage *protobuf_message = NULL;

  char *error = (char *)malloc(sizeof(char) * 256);

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

  result->protobuf.len = pg_query__parse_result__get_packed_size(parse_result);
  result->protobuf.data = malloc(sizeof(char) * result->protobuf.len);

  pg_query__parse_result__pack(parse_result, (uint8_t *)result->protobuf.data);

  protobuf_c_message_free_unpacked(protobuf_message, NULL);

  return result;
}

void free_protobuf_to_json_result(ProtobufToJsonResult *result) {
  if (result->json_string) {
    free(result->json_string);
  }
  if (result->error) {
    free(result->error);
  }
  free(result);
}

void free_json_to_protobuf_result(JsonToProtobufResult *result) {
  if (result->protobuf.data) {
    free(result->protobuf.data);
  }
  if (result->error) {
    free(result->error);
  }
  free(result);
}
