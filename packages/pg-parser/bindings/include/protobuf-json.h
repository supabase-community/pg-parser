
#ifndef PROTOBUF_JSON_H
#define PROTOBUF_JSON_H

#include "pg_query.h"

typedef struct {
  char *json_string;
  char *error;
} ProtobufToJsonResult;

typedef struct {
  PgQueryProtobuf protobuf;
  char *error;
} JsonToProtobufResult;

ProtobufToJsonResult *protobuf_to_json(PgQueryProtobuf *protobuf);
JsonToProtobufResult *json_to_protobuf(char *json_string);
void free_protobuf_to_json_result(ProtobufToJsonResult *result);
void free_json_to_protobuf_result(JsonToProtobufResult *result);

#endif
