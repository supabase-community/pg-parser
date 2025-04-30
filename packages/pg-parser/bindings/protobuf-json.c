#define _POSIX_C_SOURCE 200809L

#include <stdlib.h>
#include <stdio.h>
#include <string.h>

#include "pg_query.h"
#include "protobuf2json.h"
#include "protobuf/pg_query.pb-c.h"
#include "macros.h"

typedef struct
{
  char *json_string;
  char *error;
} ProtobufToJsonResult;

EXPORT("protobuf_to_json")
ProtobufToJsonResult *protobuf_to_json(PgQueryProtobuf *protobuf)
{
  ProtobufToJsonResult *result = (ProtobufToJsonResult *)malloc(sizeof(ProtobufToJsonResult));

  // Unpack the protobuf binary data back into a message
  PgQuery__ParseResult *parse_result = pg_query__parse_result__unpack(NULL, protobuf->len, (uint8_t *)protobuf->data);
  if (!parse_result)
  {
    result->error = strdup("Failed to unpack protobuf message");
    return result;
  }

  char *error = (char *)malloc(256);

  // Convert the protobuf message to JSON
  int ret = protobuf2json_string(
      &parse_result->base,
      0,
      &result->json_string,
      error,
      sizeof(*error));

  if (ret != 0)
  {
    result->error = error;
    return result;
  }

  free(error);
  return result;
}

EXPORT("free_protobuf_to_json_result")
void free_protobuf_to_json_result(ProtobufToJsonResult *result)
{
  if (result->json_string)
  {
    free(result->json_string);
  }
  if (result->error)
  {
    free(result->error);
  }
  free(result);
}
