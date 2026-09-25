package rpc

import (
	"bufio"
	"encoding/json"
	"io"
)

const maxLine = 1 << 20

type Request struct {
	ID     uint64          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type Response struct {
	ID     uint64 `json:"id"`
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

func Serve(input io.Reader, output io.Writer, call func(method string, params json.RawMessage) (any, error)) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), maxLine)
	writer := bufio.NewWriter(output)
	for scanner.Scan() {
		var req Request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			if err := writeResponse(writer, Response{Error: "invalid request"}); err != nil {
				return err
			}
			continue
		}

		result, callErr := call(req.Method, req.Params)
		res := Response{ID: req.ID, Result: result}
		if callErr != nil {
			res.Result = nil
			res.Error = callErr.Error()
		}
		if err := writeResponse(writer, res); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func writeResponse(writer *bufio.Writer, value Response) error {
	if err := json.NewEncoder(writer).Encode(value); err != nil {
		return err
	}
	return writer.Flush()
}
