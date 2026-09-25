package localapi

import (
	"encoding/json"
	"reflect"
	"sort"
	"strings"
)

func buildOpenAPISpec(serverURL string) map[string]any {
	methods := rpcMethods()
	names := make([]string, 0, len(methods))
	for name := range methods {
		names = append(names, name)
	}
	sort.Strings(names)

	schemas := map[string]any{}
	requestVariants := make([]any, 0, len(names))
	resultVariants := make([]any, 0, len(names))
	for _, name := range names {
		spec := methods[name]
		methodSchemaName := "RPCRequest_" + strings.ReplaceAll(name, ".", "_")
		paramsSchema := schemaForGoType(spec.params, schemas)
		schemas[methodSchemaName] = map[string]any{
			"type": "object", "required": []string{"method", "params"},
			"properties": map[string]any{
				"id":     map[string]any{"type": "integer", "format": "int64", "example": 1},
				"method": map[string]any{"type": "string", "enum": []string{name}},
				"params": paramsSchema,
			},
		}
		requestVariants = append(requestVariants, map[string]any{"$ref": "#/components/schemas/" + methodSchemaName})
		resultVariants = append(resultVariants, schemaForGoType(spec.result, schemas))
	}
	schemas["RPCRequest"] = map[string]any{"oneOf": requestVariants}
	schemas["RPCResult"] = map[string]any{"oneOf": resultVariants, "nullable": true}
	schemas["RPCResponse"] = map[string]any{
		"type": "object", "properties": map[string]any{
			"id":     map[string]any{"type": "integer", "format": "int64"},
			"result": map[string]any{"$ref": "#/components/schemas/RPCResult"},
			"error":  map[string]any{"type": "string"},
		},
	}
	return map[string]any{
		"openapi": "3.0.3",
		"info": map[string]any{
			"title": "BetterSoundCloud local Go sidecar", "version": appVersion,
			"description": "Development-only HTTP bridge for the sidecar JSON-RPC methods. Request and result schemas are generated from Go types.",
		},
		"servers": []any{map[string]any{"url": serverURL}},
		"paths": map[string]any{
			"/rpc": map[string]any{"post": map[string]any{
				"operationId": "callSidecarMethod", "summary": "Call a Go sidecar method",
				"description": "The request model is a oneOf of every registered Go method and its typed params.",
				"requestBody": map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{
					"schema": map[string]any{"$ref": "#/components/schemas/RPCRequest"},
				}}},
				"responses": map[string]any{
					"200": map[string]any{"description": "JSON-RPC response", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/RPCResponse"}}}},
					"400": map[string]any{"description": "Invalid request or method error", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/RPCResponse"}}}},
				},
			}},
		},
		"components": map[string]any{"schemas": schemas},
	}
}

func schemaForGoType(t reflect.Type, components map[string]any) any {
	if t == reflect.TypeOf(json.RawMessage{}) {
		return map[string]any{"type": "object", "additionalProperties": true}
	}
	switch t.Kind() {
	case reflect.Pointer:
		inner := schemaForGoType(t.Elem(), components)
		if schema, ok := inner.(map[string]any); ok {
			copy := make(map[string]any, len(schema)+1)
			for key, value := range schema {
				copy[key] = value
			}
			copy["nullable"] = true
			return copy
		}
		return inner
	case reflect.Struct:
		if t.Name() == "" {
			return structSchema(t, components)
		}
		name := t.Name()
		if _, exists := components[name]; !exists {
			components[name] = map[string]any{"type": "object", "properties": map[string]any{}}
			components[name] = structSchema(t, components)
		}
		return map[string]any{"$ref": "#/components/schemas/" + name}
	case reflect.Slice, reflect.Array:
		return map[string]any{"type": "array", "items": schemaForGoType(t.Elem(), components)}
	case reflect.Map:
		return map[string]any{"type": "object", "additionalProperties": schemaForGoType(t.Elem(), components)}
	case reflect.String:
		return map[string]any{"type": "string"}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32:
		return map[string]any{"type": "integer", "format": "int32"}
	case reflect.Int64:
		return map[string]any{"type": "integer", "format": "int64"}
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return map[string]any{"type": "integer", "format": "int64", "minimum": 0}
	case reflect.Float32:
		return map[string]any{"type": "number", "format": "float"}
	case reflect.Float64:
		return map[string]any{"type": "number", "format": "double"}
	case reflect.Interface:
		return map[string]any{}
	default:
		return map[string]any{}
	}
}

func structSchema(t reflect.Type, components map[string]any) map[string]any {
	properties := map[string]any{}
	required := []string{}
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if !field.IsExported() {
			continue
		}
		parts := strings.Split(field.Tag.Get("json"), ",")
		name := parts[0]
		if name == "-" {
			continue
		}
		if name == "" {
			name = strings.ToLower(field.Name[:1]) + field.Name[1:]
		}
		properties[name] = schemaForGoType(field.Type, components)
		optional := field.Type.Kind() == reflect.Pointer
		for _, option := range parts[1:] {
			if option == "omitempty" {
				optional = true
			}
		}
		if !optional {
			required = append(required, name)
		}
	}
	schema := map[string]any{"type": "object", "properties": properties}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}
