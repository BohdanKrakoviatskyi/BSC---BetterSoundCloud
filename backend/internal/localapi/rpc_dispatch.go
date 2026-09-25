package localapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"reflect"
	"time"
)

func (s *service) call(method string, params json.RawMessage) (any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	startedAt := time.Now()
	log.Printf("rpc stage=received method=%q params_bytes=%d", method, len(params))
	spec, ok := rpcMethods()[method]
	if !ok {
		log.Printf("rpc stage=dispatch_error method=%q error=%q", method, "unknown method")
		return nil, errors.New("unknown method")
	}
	paramsValue := reflect.New(spec.params)
	if len(params) == 0 {
		params = json.RawMessage(`{}`)
	}
	if err := json.Unmarshal(params, paramsValue.Interface()); err != nil {
		wrapped := fmt.Errorf("invalid %s payload: %w", method, err)
		log.Printf("rpc stage=decode_error method=%q params_type=%s error=%q", method, spec.params, wrapped.Error())
		return nil, wrapped
	}
	methodValue := reflect.ValueOf(s).MethodByName(spec.goName)
	if !methodValue.IsValid() {
		log.Printf("rpc stage=dispatch_error method=%q go_method=%q error=%q", method, spec.goName, "method disappeared after discovery")
		return nil, errors.New("unknown method")
	}
	outputs := methodValue.Call([]reflect.Value{paramsValue.Elem()})
	if !outputs[1].IsNil() {
		err := outputs[1].Interface().(error)
		log.Printf("rpc stage=handler_error method=%q go_method=%q elapsed_ms=%d error=%q", method, spec.goName, time.Since(startedAt).Milliseconds(), err.Error())
		return nil, err
	}
	log.Printf("rpc stage=complete method=%q result_type=%s elapsed_ms=%d", method, spec.result, time.Since(startedAt).Milliseconds())
	return outputs[0].Interface(), nil
}
