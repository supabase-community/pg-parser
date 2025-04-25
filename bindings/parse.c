#include <stdlib.h>
#include "pg_query.h"
#include "macros.h"

EXPORT("parse_sql")
PgQueryParseResult *parse_sql(char *sql)
{
  PgQueryParseResult *result = (PgQueryParseResult *)malloc(sizeof(PgQueryParseResult));
  *result = pg_query_parse(sql);
  return result;
}

EXPORT("free_parse_result")
void free_parse_result(PgQueryParseResult *result)
{
  pg_query_free_parse_result(*result);
  free(result);
}