package localapi

import (
	"reflect"
	"strings"
	"unicode"
)

type rpcMethodSpec struct {
	goName string
	params reflect.Type
	result reflect.Type
}

func rpcMethods() map[string]rpcMethodSpec {
	methods := map[string]rpcMethodSpec{}
	errorType := reflect.TypeOf((*error)(nil)).Elem()
	serviceType := reflect.TypeOf((*service)(nil))
	for i := 0; i < serviceType.NumMethod(); i++ {
		method := serviceType.Method(i)
		if !strings.HasPrefix(method.Name, "RPC") || method.Type.NumIn() != 2 || method.Type.NumOut() != 2 || method.Type.Out(1) != errorType {
			continue
		}
		apiName := rpcNameFromGo(method.Name)
		methods[apiName] = rpcMethodSpec{goName: method.Name, params: method.Type.In(1), result: method.Type.Out(0)}
	}
	return methods
}

func rpcNameFromGo(goName string) string {
	runes := []rune(strings.TrimPrefix(goName, "RPC"))
	var result strings.Builder
	for i, current := range runes {
		if i > 0 && unicode.IsUpper(current) {
			previous := runes[i-1]
			nextIsLower := i+1 < len(runes) && unicode.IsLower(runes[i+1])
			if unicode.IsLower(previous) || unicode.IsDigit(previous) || (unicode.IsUpper(previous) && nextIsLower) {
				result.WriteByte('.')
			}
		}
		result.WriteRune(unicode.ToLower(current))
	}
	return result.String()
}
