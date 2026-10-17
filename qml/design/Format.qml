pragma Singleton
pragma ComponentBehavior: Bound
import QtQuick

QtObject {
    /// "3:07", as playbackTime() writes a song's time
    function playbackTime(milliseconds: real): string {
        const seconds = Math.max(Math.floor(milliseconds / 1000), 0)
        const remainder = seconds % 60
        return Math.floor(seconds / 60) + ":" + (remainder < 10 ? "0" : "") + remainder
    }

    /// "3 hr 24 min", a collection's running time; empty when nothing reports one
    function totalDuration(milliseconds: real): string {
        if (milliseconds <= 0) {
            return ""
        }
        const totalMinutes = Math.floor(milliseconds / 60000)
        const hours = Math.floor(totalMinutes / 60)
        const minutes = totalMinutes % 60
        if (hours > 0) {
            return minutes > 0 ? hours + " hr " + minutes + " min" : hours + " hr"
        }
        return minutes + " min"
    }

    /// "12 songs", "1 song"
    function songCount(count: int): string {
        return count + (count === 1 ? " song" : " songs")
    }

    function joined(parts: list<string>, separator: string): string {
        let result = ""
        for (let index = 0; index < parts.length; ++index) {
            const part = parts[index]
            if (part.length === 0) {
                continue
            }
            result += (result.length > 0 ? separator : "") + part
        }
        return result
    }

    /// a size as the mac's file formatter puts it: decimal units, one
    /// decimal place below a hundred
    function fileSize(bytes: real): string {
        if (bytes <= 0) {
            return "Zero KB"
        }
        if (bytes < 1000) {
            return Math.round(bytes) + " bytes"
        }
        const units = ["KB", "MB", "GB", "TB"]
        let value = bytes / 1000
        let unit = 0
        while (value >= 1000 && unit < units.length - 1) {
            value /= 1000
            unit += 1
        }
        return (value >= 100 ? String(Math.round(value)) : value.toFixed(1)) + " " + units[unit]
    }

    /// "1.2M", "540K", "120"
    function compactCount(count: real): string {
        if (!count || count <= 0) {
            return "0"
        }
        if (count >= 1000000) {
            const m = count / 1000000
            const formatted = (m >= 100) ? Math.round(m).toString() : m.toFixed(1)
            return (formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted) + "M"
        }
        if (count >= 1000) {
            const k = count / 1000
            const formatted = (k >= 100) ? Math.round(k).toString() : k.toFixed(1)
            return (formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted) + "K"
        }
        return Math.round(count).toLocaleString()
    }
}
